const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, createPatient, createAppointment, bearer, tokenFor } = require('./helpers/factories');
const { MONDAY } = require('./helpers/time');
const { parseVitals, bmiOf } = require('../src/services/vitals');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const base = (patientId, path = '') => `/api/patients/${patientId}/clinical/vitals${path}`;
const list = (token, patientId) => request(app).get(base(patientId)).set(bearer(token));
const record = (token, patientId, body) => request(app).post(base(patientId)).set(bearer(token)).send(body);
const voidIt = (token, patientId, id, body = {}) => request(app).post(base(patientId, `/${id}/void`)).set(bearer(token)).send(body);
const audit = () => prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });

const READING = { weightKg: 70.5, heightCm: 170, systolic: 120, diastolic: 80, heartRate: 72, respiratoryRate: 16, temperatureC: 36.6, oxygenSaturation: 98 };

const NOW = new Date('2026-10-22T15:00:00Z');

describe('parseVitals', () => {
  it('takes a full reading and leaves what was not taken as null', () => {
    expect(parseVitals(READING, NOW).data).toMatchObject(READING);
    const partial = parseVitals({ weightKg: 3.21 }, NOW).data;
    expect(partial).toMatchObject({ weightKg: 3.21, heightCm: null, systolic: null, oxygenSaturation: null });
    expect(partial.measuredAt).toEqual(NOW);
  });

  it('treats empty strings and null as not taken', () => {
    expect(parseVitals({ weightKg: '', heartRate: null, temperatureC: 37 }, NOW).data).toMatchObject({ weightKg: null, heartRate: null, temperatureC: 37 });
  });

  it.each([
    [{}, /at least one measurement/],
    [{ weightKg: '70' }, /weightKg must be a number/],
    [{ weightKg: NaN }, /must be a number/],
    [{ heartRate: 72.5 }, /heartRate must be a whole number/],
    [{ weightKg: 70.123 }, /weightKg can have at most 2 decimals/],
    [{ heightCm: 170.55 }, /heightCm can have at most 1 decimal/],
    [{ temperatureC: 36.55 }, /temperatureC can have at most 1 decimal/],
    [{ weightKg: 700 }, /weightKg must be between 0.3 and 500/],
    [{ weightKg: 0 }, /weightKg must be between/],
    [{ heightCm: 5 }, /heightCm must be between/],
    [{ heartRate: 7 }, /heartRate must be between 20 and 300/],
    [{ respiratoryRate: 150 }, /respiratoryRate must be between/],
    [{ temperatureC: 50 }, /temperatureC must be between 25 and 45/],
    [{ oxygenSaturation: 101 }, /oxygenSaturation must be between 30 and 100/],
    [{ systolic: 120 }, /needs both numbers/],
    [{ diastolic: 80 }, /needs both numbers/],
    [{ systolic: 80, diastolic: 80 }, /systolic must be higher than diastolic/],
    [{ systolic: 70, diastolic: 90 }, /systolic must be higher/],
    [{ weightKg: 70, measuredAt: 'yesterday' }, /measuredAt must be a date/],
    [{ weightKg: 70, measuredAt: 5 }, /measuredAt must be a date/],
    [{ weightKg: 70, measuredAt: '2026-10-22T16:00:00Z' }, /cannot be in the future/],
    [{ weightKg: 70, measuredAt: '1999-12-31T00:00:00Z' }, /too far in the past/]
  ])('refuses %j', (body, message) => {
    expect(parseVitals(body, NOW).error).toMatch(message);
  });

  it('allows the edges, a measurement taken earlier and a clock a few minutes ahead', () => {
    expect(parseVitals({ weightKg: 0.3, heightCm: 260, heartRate: 300, oxygenSaturation: 100 }, NOW).error).toBeUndefined();
    expect(parseVitals({ weightKg: 70, measuredAt: '2026-10-01T09:30:00Z' }, NOW).data.measuredAt).toEqual(new Date('2026-10-01T09:30:00Z'));
    expect(parseVitals({ weightKg: 70, measuredAt: '2026-10-22T15:04:00Z' }, NOW).error).toBeUndefined();
  });
});

describe('bmiOf', () => {
  it.each([
    [{ weightKg: 70.5, heightCm: 170 }, 24.4],
    [{ weightKg: 68.1, heightCm: 162 }, 25.9],
    [{ weightKg: 3.2, heightCm: 50 }, 12.8]
  ])('%j is %s', (reading, expected) => expect(bmiOf(reading)).toBe(expected));

  it('is null without both weight and height', () => {
    expect(bmiOf({ weightKg: 70, heightCm: null })).toBeNull();
    expect(bmiOf({ weightKg: null, heightCm: 170 })).toBeNull();
    expect(bmiOf({})).toBeNull();
  });
});

describe('recording and listing', () => {
  it.each(['doctor', 'admin'])('a %s records a reading and reads it back with the BMI', async (role) => {
    const { user, token } = await createUser({ role, name: 'Dra. Vega' });
    const patient = await createPatient();

    const created = await record(token, patient.id, READING);

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ...READING, bmi: 24.4, recordedById: user.id, recordedByName: 'Dra. Vega', voidedAt: null, appointmentId: null });
    const res = await list(token, patient.id);
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.readings.map((r) => r.id)).toEqual([created.body.id]);
    expect(res.body.readings[0].bmi).toBe(24.4);
  });

  it('lists the newest measurement first, by when it was taken and not when it was typed', async () => {
    const { token } = await createUser();
    const patient = await createPatient();
    const old = await record(token, patient.id, { weightKg: 70, measuredAt: '2026-01-10T09:00:00Z' });
    const recent = await record(token, patient.id, { weightKg: 69, measuredAt: '2026-09-10T09:00:00Z' });
    const middle = await record(token, patient.id, { weightKg: 69.5, measuredAt: '2026-05-10T09:00:00Z' });

    const res = await list(token, patient.id);

    expect(res.body.readings.map((r) => r.id)).toEqual([recent.body.id, middle.body.id, old.body.id]);
  });

  it('refuses a bad body without recording anything', async () => {
    const { token } = await createUser();
    const patient = await createPatient();

    expect((await record(token, patient.id, { weightKg: 700 })).status).toBe(400);
    expect((await record(token, patient.id, {})).status).toBe(400);
    expect((await record(token, patient.id, { weightKg: 70, appointmentId: 5 })).status).toBe(400);
    expect(await prisma.patientVitals.count()).toBe(0);
  });

  it('links a reading to a visit of the same patient, and refuses other appointments', async () => {
    const clinic = await createClinic();
    const doctor = await createUser({ role: 'doctor', clinic });
    const patient = await createPatient({ clinic });
    const other = await createPatient({ clinic });
    const visit = await createAppointment({ doctor: doctor.user, patient, date: MONDAY, time: '09:00' });
    const otherVisit = await createAppointment({ doctor: doctor.user, patient: other, date: MONDAY, time: '10:00' });
    const foreignDoctor = await createUser({ role: 'doctor', clinic: await createClinic() });
    const foreignPatient = await createPatient({ clinic: { id: foreignDoctor.user.clinicId } });
    const foreignVisit = await createAppointment({ doctor: foreignDoctor.user, patient: foreignPatient, date: MONDAY, time: '09:00' });

    expect((await record(doctor.token, patient.id, { ...READING, appointmentId: visit.id })).body.appointmentId).toBe(visit.id);
    expect((await record(doctor.token, patient.id, { ...READING, appointmentId: otherVisit.id })).status).toBe(404);
    expect((await record(doctor.token, patient.id, { ...READING, appointmentId: foreignVisit.id })).status).toBe(404);
    expect((await record(doctor.token, patient.id, { ...READING, appointmentId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
    expect(await prisma.patientVitals.count()).toBe(1);
  });

  it('shows at most the newest 500 and says when there are more', async () => {
    const { token, user } = await createUser();
    const patient = await createPatient();
    await prisma.patientVitals.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        weightKg: 70, measuredAt: new Date(Date.UTC(2020, 0, 1) + i * 3600000), patientId: patient.id, clinicId: patient.clinicId, recordedById: user.id, recordedByName: user.name
      }))
    });

    const res = await list(token, patient.id);

    expect(res.body.readings).toHaveLength(500);
    expect(res.body.truncated).toBe(true);
    expect(new Date(res.body.readings[0].measuredAt)).toEqual(new Date(Date.UTC(2020, 0, 1) + 500 * 3600000));
  });

  it('has no way to edit or delete a reading', async () => {
    const { token } = await createUser();
    const patient = await createPatient();
    const { body } = await record(token, patient.id, READING);

    for (const method of ['put', 'patch', 'delete']) {
      const res = await request(app)[method](base(patient.id, `/${body.id}`)).set(bearer(token)).send({ weightKg: 1 });
      expect(res.status).toBe(404);
    }
    expect((await prisma.patientVitals.findUnique({ where: { id: body.id } })).weightKg).toBe(70.5);
  });
});

describe('who can reach the vital signs', () => {
  it('the secretary is refused on every route and nothing changes', async () => {
    const doctor = await createUser({ role: 'doctor' });
    const secretary = await createUser({ role: 'secretary' });
    const patient = await createPatient();
    const { body } = await record(doctor.token, patient.id, READING);
    const before = (await audit()).length;

    for (const res of [
      await list(secretary.token, patient.id),
      await record(secretary.token, patient.id, READING),
      await voidIt(secretary.token, patient.id, body.id)
    ]) expect(res.status).toBe(403);
    expect(await prisma.patientVitals.count()).toBe(1);
    expect((await audit()).length).toBe(before);
  });

  it.each(['doctor', 'admin', 'secretary'])('a %s of another clinic gets nothing and changes nothing', async (role) => {
    const doctor = await createUser({ role: 'doctor' });
    const patient = await createPatient();
    const { body } = await record(doctor.token, patient.id, READING);
    const outsider = await createUser({ role, clinic: await createClinic() });
    const expected = role === 'secretary' ? 403 : 404;

    for (const res of [
      await list(outsider.token, patient.id),
      await record(outsider.token, patient.id, READING),
      await voidIt(outsider.token, patient.id, body.id)
    ]) expect(res.status).toBe(expected);
    expect(await prisma.patientVitals.count()).toBe(1);
    expect((await prisma.patientVitals.findUnique({ where: { id: body.id } })).voidedAt).toBeNull();
  });

  it('a reading cannot be reached through another patient of the same clinic', async () => {
    const { token } = await createUser();
    const patient = await createPatient();
    const other = await createPatient();
    const { body } = await record(token, patient.id, READING);

    expect((await voidIt(token, other.id, body.id)).status).toBe(404);
    expect((await list(token, other.id)).body.readings).toEqual([]);
  });

  it('a doctor turned secretary is refused with the old token; 401 without a token', async () => {
    const { user } = await createUser({ role: 'doctor' });
    const stale = tokenFor(user);
    await prisma.doctor.update({ where: { id: user.id }, data: { role: 'secretary' } });
    const patient = await createPatient();

    expect((await list(stale, patient.id)).status).toBe(403);
    expect((await request(app).get(base(patient.id))).status).toBe(401);
    expect((await list((await createUser()).token, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});

describe('voiding a reading', () => {
  it('keeps it in the history, marked, with who voided it and why', async () => {
    const { user, token } = await createUser({ name: 'Dra. Vega' });
    const patient = await createPatient();
    const { body } = await record(token, patient.id, READING);

    const res = await voidIt(token, patient.id, body.id, { reason: '  Paciente equivocado  ' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ voidedById: user.id, voidedByName: 'Dra. Vega', voidReason: 'Paciente equivocado', weightKg: 70.5 });
    expect(res.body.voidedAt).toBeTruthy();
    const listed = (await list(token, patient.id)).body.readings;
    expect(listed).toHaveLength(1);
    expect(listed[0].voidedAt).toBeTruthy();
  });

  it('the reason is optional', async () => {
    const { token } = await createUser();
    const patient = await createPatient();
    const { body } = await record(token, patient.id, READING);

    expect((await voidIt(token, patient.id, body.id)).body.voidReason).toBeNull();
  });

  it('its author or an admin voids it, another doctor does not', async () => {
    const ctx = await createUser({ role: 'doctor' });
    const colleague = await createUser({ role: 'doctor', clinic: { id: ctx.user.clinicId } });
    const admin = await createUser({ role: 'admin' });
    const patient = await createPatient();
    const first = (await record(ctx.token, patient.id, READING)).body;
    const second = (await record(ctx.token, patient.id, READING)).body;

    expect((await voidIt(colleague.token, patient.id, first.id)).status).toBe(403);
    expect((await voidIt(admin.token, patient.id, first.id)).status).toBe(200);
    expect((await voidIt(ctx.token, patient.id, second.id)).status).toBe(200);
  });

  it('cannot be voided twice, nor with a bad reason, nor when it does not exist', async () => {
    const { token } = await createUser();
    const patient = await createPatient();
    const { body } = await record(token, patient.id, READING);

    expect((await voidIt(token, patient.id, body.id, { reason: 5 })).status).toBe(400);
    expect((await voidIt(token, patient.id, body.id, { reason: 'x'.repeat(201) })).status).toBe(400);
    expect((await voidIt(token, patient.id, body.id)).status).toBe(200);
    expect((await voidIt(token, patient.id, body.id)).status).toBe(409);
    expect((await voidIt(token, patient.id, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});

describe('the audit', () => {
  it('records the creation and the voiding with the patient and never the measurements or the reason', async () => {
    const { user, token } = await createUser({ role: 'doctor' });
    const patient = await createPatient();
    const visit = await createAppointment({ doctor: user, patient, date: MONDAY, time: '09:00' });

    const { body } = await record(token, patient.id, { ...READING, weightKg: 77.7, appointmentId: visit.id });
    await voidIt(token, patient.id, body.id, { reason: 'Motivo reservado' });

    const entries = await audit();
    expect(entries.map((e) => e.action)).toEqual(['create', 'update']);
    expect(entries[0]).toMatchObject({ entity: 'patient_vitals', entityId: body.id, actorId: user.id, actorRole: 'doctor', clinicId: user.clinicId });
    expect(entries[0].changes).toEqual({ patientId: { to: patient.id }, appointmentId: { to: visit.id } });
    expect(entries[1].changes).toEqual({ patientId: { to: patient.id }, voided: { from: false, to: true }, voidReason: { changed: true } });
    const dump = JSON.stringify(entries);
    expect(dump).not.toContain('77.7');
    expect(dump).not.toContain('Motivo reservado');
  });

  it.each(['doctor', 'admin'])('records every read of the history by a %s', async (role) => {
    const { user, token } = await createUser({ role });
    const patient = await createPatient();

    await list(token, patient.id);
    await list(token, patient.id);

    const reads = (await audit()).filter((e) => e.action === 'read');
    expect(reads).toHaveLength(2);
    expect(reads[0]).toMatchObject({ entity: 'clinical_record', entityId: patient.id, actorId: user.id, actorRole: role, changes: { section: { to: 'vitals' } } });
  });

  it('the activity log filter knows the new entity', async () => {
    const admin = await createUser({ role: 'admin' });
    const patient = await createPatient();
    await record(admin.token, patient.id, READING);

    const res = await request(app).get('/api/admin/audit-log?entity=patient_vitals').set(bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
  });
});

describe('the rest of the system', () => {
  it('a patient with readings cannot be deleted, not even by the database', async () => {
    const admin = await createUser({ role: 'admin' });
    const patient = await createPatient();
    await record(admin.token, patient.id, READING);

    const res = await request(app).delete(`/api/patients/${patient.id}`).set(bearer(admin.token));

    expect(res.status).toBe(409);
    await expect(prisma.patient.delete({ where: { id: patient.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('the appointment of a reading cannot be deleted either', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    const visit = await createAppointment({ doctor: user, patient, date: MONDAY, time: '09:00' });
    await record(token, patient.id, { ...READING, appointmentId: visit.id });

    await expect(prisma.appointment.delete({ where: { id: visit.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('the export of the patient includes the readings, oldest first', async () => {
    const admin = await createUser({ role: 'admin' });
    const patient = await createPatient();
    await record(admin.token, patient.id, { weightKg: 71, measuredAt: '2026-09-01T09:00:00Z' });
    await record(admin.token, patient.id, { weightKg: 70, measuredAt: '2026-01-01T09:00:00Z' });

    const res = await request(app).get(`/api/patients/${patient.id}/export`).set(bearer(admin.token));

    expect(res.body.vitalSigns.map((r) => r.weightKg)).toEqual([70, 71]);
  });

  it('the database refuses a reading for a patient of another clinic', async () => {
    const { user } = await createUser();
    const patient = await createPatient();
    const other = await createClinic();

    await expect(prisma.patientVitals.create({
      data: { weightKg: 70, measuredAt: new Date(), patientId: patient.id, clinicId: other.id, recordedById: user.id, recordedByName: user.name }
    })).rejects.toMatchObject({ code: 'P2003' });
  });
});
