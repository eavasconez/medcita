const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, createPatient, createAppointment, bearer, tokenFor } = require('./helpers/factories');
const { MONDAY } = require('./helpers/time');
const { ageOn, isMinor, parseProfile } = require('../src/services/patientRecord');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const today = () => new Date().toISOString().slice(0, 10);
const yearsAgo = (n) => `${Number(today().slice(0, 4)) - n}${today().slice(4)}`;

const RECORD = {
  birthDate: '1985-06-15',
  sex: 'female',
  address: 'Av. Amazonas N24-03, Quito',
  occupation: 'Ingeniera',
  emergencyContactName: 'Luis Quispe',
  emergencyContactPhone: '+593 99 123 4567',
  insuranceProvider: 'IESS',
  insuranceNumber: 'A-123456'
};

const create = (token, body) => request(app).post('/api/patients').set(bearer(token)).send(body);
const update = (token, id, body) => request(app).put(`/api/patients/${id}`).set(bearer(token)).send(body);
const show = (token, id) => request(app).get(`/api/patients/${id}`).set(bearer(token));
const audit = () => prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });

describe('ageOn and isMinor', () => {
  it.each([
    ['2026-10-22', '2026-10-22', { years: 0, months: 0 }],
    ['2026-05-22', '2026-10-22', { years: 0, months: 5 }],
    ['2026-05-23', '2026-10-22', { years: 0, months: 4 }],
    ['2008-10-22', '2026-10-22', { years: 18, months: 0 }],
    ['2008-10-23', '2026-10-22', { years: 17, months: 11 }],
    ['2024-02-29', '2026-02-28', { years: 1, months: 11 }],
    ['1985-06-15', '2026-10-22', { years: 41, months: 4 }]
  ])('born %s, on %s: %j', (birth, on, expected) => {
    expect(ageOn(birth, on)).toEqual(expected);
  });

  it('is null without a birth date', () => {
    expect(ageOn(null, '2026-10-22')).toBeNull();
    expect(isMinor(null, '2026-10-22')).toBe(false);
  });

  it('turns 18 on the birthday itself', () => {
    expect(isMinor('2008-10-23', '2026-10-22')).toBe(true);
    expect(isMinor('2008-10-22', '2026-10-22')).toBe(false);
  });
});

describe('parseProfile', () => {
  const parse = (body) => parseProfile(body, '2026-10-22');

  it('returns only what was sent', () => {
    expect(parse({ sex: 'male', name: 'ignored' })).toEqual({ data: { sex: 'male' } });
    expect(parse({})).toEqual({ data: {} });
  });

  it('turns blank values and null into null (clears the field)', () => {
    expect(parse({ address: '   ', occupation: null }).data).toEqual({ address: null, occupation: null });
  });

  it.each([
    [{ birthDate: '2026-02-30' }, /real date/],
    [{ birthDate: '2026-10-23' }, /future/],
    [{ birthDate: '1899-12-31' }, /before/],
    [{ birthDate: 19850615 }, /text/],
    [{ sex: 'x' }, /sex must be one of/],
    [{ emergencyContactPhone: 'abc' }, /not a valid phone/],
    [{ guardianPhone: '12' }, /not a valid phone/],
    [{ address: 'a'.repeat(301) }, /at most 300/],
    [{ occupation: { a: 1 } }, /must be text/]
  ])('rejects %j', (body, message) => {
    expect(parse(body).error).toMatch(message);
  });

  it('accepts today as a birth date', () => {
    expect(parse({ birthDate: '2026-10-22' }).data.birthDate).toBe('2026-10-22');
  });
});

describe('creating and updating the record', () => {
  it.each(['doctor', 'admin', 'secretary'])('a %s can register a patient with a full record', async (role) => {
    const { token } = await createUser({ role });

    const res = await create(token, { name: 'Zulema Quispe', phone: '+593991234567', ...RECORD });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(RECORD);
    expect(await prisma.patient.findUnique({ where: { id: res.body.id } })).toMatchObject(RECORD);
  });

  it('a patient registered the old way has an empty record', async () => {
    const { token } = await createUser();

    const res = await create(token, { name: 'Sin Ficha', phone: '+593991111111' });

    expect(res.status).toBe(201);
    expect(res.body.birthDate).toBeNull();
    expect(res.body.guardianName).toBeNull();
  });

  it('updates some fields and keeps the others', async () => {
    const { token } = await createUser();
    const patient = await createPatient({ ...RECORD });

    const res = await update(token, patient.id, { occupation: 'Médica', guardianName: 'Ana Perez' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ...RECORD, occupation: 'Médica', guardianName: 'Ana Perez' });
  });

  it('clears a field with an empty string', async () => {
    const { token } = await createUser();
    const patient = await createPatient({ ...RECORD });

    const res = await update(token, patient.id, { insuranceProvider: '', insuranceNumber: '' });

    expect(res.body.insuranceProvider).toBeNull();
    expect(res.body.insuranceNumber).toBeNull();
    expect(res.body.sex).toBe('female');
  });

  it('refuses a bad value without touching the patient', async () => {
    const { token } = await createUser();
    const patient = await createPatient({ ...RECORD });

    const res = await update(token, patient.id, { occupation: 'Otra', birthDate: '2999-01-01' });

    expect(res.status).toBe(400);
    expect((await prisma.patient.findUnique({ where: { id: patient.id } })).occupation).toBe('Ingeniera');
  });

  it('refuses a bad value when registering', async () => {
    const { token } = await createUser();
    const res = await create(token, { name: 'X', phone: '+593991111112', sex: 'robot' });
    expect(res.status).toBe(400);
    expect(await prisma.patient.count()).toBe(0);
  });

  it('adds the record to a patient that already exists, found by phone', async () => {
    const { token } = await createUser();
    const patient = await createPatient({ phone: '+593992222222' });

    const res = await create(token, { name: patient.name, phone: '+593992222222', sex: 'male', birthDate: '1990-01-01' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(patient.id);
    expect(res.body).toMatchObject({ sex: 'male', birthDate: '1990-01-01' });
  });

  it('booking again with no record fields does not wipe the record', async () => {
    const { token } = await createUser();
    const patient = await createPatient({ phone: '+593993333333', ...RECORD });

    await create(token, { name: 'Nuevo Nombre', phone: '+593993333333' });

    expect(await prisma.patient.findUnique({ where: { id: patient.id } })).toMatchObject({ name: 'Nuevo Nombre', ...RECORD });
  });

  it('another clinic cannot update it (404)', async () => {
    const other = await createUser({ clinic: await createClinic() });
    const patient = await createPatient({ ...RECORD });

    expect((await update(other.token, patient.id, { occupation: 'Hack' })).status).toBe(404);
    expect((await prisma.patient.findUnique({ where: { id: patient.id } })).occupation).toBe('Ingeniera');
  });
});

describe('the audit of changes to the record', () => {
  it('records which fields changed and never their values', async () => {
    const { user, token } = await createUser({ role: 'secretary' });
    const patient = await createPatient({ ...RECORD });

    await update(token, patient.id, { address: 'Calle Secreta 123', emergencyContactPhone: '+593 98 765 4321', sex: 'male' });

    const [entry] = await audit();
    expect(entry).toMatchObject({ action: 'update', entity: 'patient', entityId: patient.id, actorId: user.id });
    expect(entry.changes).toEqual({ address: { changed: true }, emergencyContactPhone: { changed: true }, sex: { changed: true } });
    const dump = JSON.stringify(await audit());
    expect(dump).not.toContain('Calle Secreta');
    expect(dump).not.toContain('98 765');
  });

  it('records nothing when nothing changed', async () => {
    const { token } = await createUser({ role: 'secretary' });
    const patient = await createPatient({ ...RECORD });

    await update(token, patient.id, { ...RECORD });

    expect(await audit()).toHaveLength(0);
  });
});

describe('GET /api/patients/:id (the record screen)', () => {
  async function setup() {
    const clinic = await createClinic();
    const doctor = await createUser({ role: 'doctor', clinic, name: 'Dra. Vega' });
    const patient = await createPatient({ clinic, ...RECORD });
    await createAppointment({ doctor: doctor.user, patient, date: MONDAY, time: '09:00', status: 'completed', notes: 'Dolor de cabeza' });
    return { clinic, doctor, patient };
  }

  it('gives the patient, the age and the appointments', async () => {
    const { doctor, patient } = await setup();

    const res = await show(doctor.token, patient.id);

    expect(res.status).toBe(200);
    expect(res.body.patient).toMatchObject({ id: patient.id, ...RECORD, isMinor: false, missingGuardian: false });
    expect(res.body.patient.age.years).toBeGreaterThanOrEqual(41);
    expect(res.body.appointments).toHaveLength(1);
    expect(res.body.appointments[0]).toMatchObject({ date: MONDAY, time: '09:00', status: 'completed', doctor: { name: 'Dra. Vega' } });
    expect(res.body.canViewClinical).toBe(true);
  });

  it('lists the newest appointment first', async () => {
    const { doctor, patient } = await setup();
    await createAppointment({ doctor: doctor.user, patient, date: '2031-01-06', time: '10:00', status: 'confirmed' });

    const res = await show(doctor.token, patient.id);

    expect(res.body.appointments.map((a) => a.date)).toEqual(['2031-01-06', MONDAY]);
  });

  it.each(['doctor', 'admin', 'secretary'])('a %s sees the booking notes of the appointments and leaves no read entry', async (role) => {
    const { clinic, patient } = await setup();
    const reader = await createUser({ role, clinic });

    const res = await show(reader.token, patient.id);

    expect(res.body.appointments[0].notes).toBe('Dolor de cabeza');
    expect(res.body.canViewClinical).toBe(role !== 'secretary');
    expect((await audit()).filter((e) => e.action === 'read')).toHaveLength(0);
  });

  it('a doctor turned secretary is told at once that clinical data is closed to them, with the old token', async () => {
    const { clinic, patient } = await setup();
    const reader = await createUser({ role: 'doctor', clinic });
    await prisma.doctor.update({ where: { id: reader.user.id }, data: { role: 'secretary' } });

    const res = await show(tokenFor({ ...reader.user, role: 'doctor' }), patient.id);

    expect(res.body.canViewClinical).toBe(false);
  });

  it.each(['doctor', 'admin', 'secretary'])('a %s of another clinic gets 404 and no entry', async (role) => {
    const { patient } = await setup();
    const outsider = await createUser({ role, clinic: await createClinic() });

    const res = await show(outsider.token, patient.id);

    expect(res.status).toBe(404);
    expect(await audit()).toHaveLength(0);
  });

  it('answers 401 without a token and 404 for an unknown id', async () => {
    const { doctor } = await setup();
    expect((await request(app).get('/api/patients/abc')).status).toBe(401);
    expect((await show(doctor.token, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('warns about a minor with no legal representative, and not once there is one', async () => {
    const clinic = await createClinic();
    const doctor = await createUser({ role: 'doctor', clinic });
    const child = await createPatient({ clinic, birthDate: yearsAgo(7) });

    const without = (await show(doctor.token, child.id)).body.patient;
    expect(without).toMatchObject({ isMinor: true, missingGuardian: true });
    expect(without.age.years).toBe(7);

    await update(doctor.token, child.id, { guardianName: 'Ana Perez', guardianCedula: '1712345678', guardianPhone: '+593991234567', guardianRelationship: 'Madre' });

    const withGuardian = (await show(doctor.token, child.id)).body.patient;
    expect(withGuardian).toMatchObject({ isMinor: true, missingGuardian: false, guardianRelationship: 'Madre' });
  });

  it('the patient list carries the age too', async () => {
    const { doctor } = await setup();

    const res = await request(app).get('/api/patients').set(bearer(doctor.token));

    expect(res.body.patients[0].age.years).toBeGreaterThanOrEqual(41);
  });
});

describe('the export of a patient\'s data', () => {
  it('includes the record', async () => {
    const admin = await createUser({ role: 'admin' });
    const patient = await createPatient({ ...RECORD, guardianName: 'Ana Perez' });

    const res = await request(app).get(`/api/patients/${patient.id}/export`).set(bearer(admin.token));

    expect(res.body.patient).toMatchObject({ ...RECORD, guardianName: 'Ana Perez', guardianPhone: null });
  });
});
