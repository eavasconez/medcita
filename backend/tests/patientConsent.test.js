const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { CURRENT_CONSENT_VERSION } = require('../src/legal/healthDataConsent');
const { TUESDAY } = require('./helpers/time');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const get = (path, token) => request(app).get(path).set(bearer(token));
const post = (path, token, body) => request(app).post(path).set(bearer(token)).send(body);
const give = (token, patientId, body = {}) =>
  post(`/api/patients/${patientId}/consents`, token, { granted: true, method: 'in_person_signed', ...body });

describe('GET /api/patients/consent-document', () => {
  it('returns the text in force with the clinic\'s name filled in', async () => {
    const clinic = await createClinic({ name: 'Consultorio Torres' });
    const { token } = await createUser({ clinic });

    const res = await get('/api/patients/consent-document', token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'health_data', version: CURRENT_CONSENT_VERSION });
    expect(res.body.paragraphs[0]).toContain('Consultorio Torres');
    expect(JSON.stringify(res.body.paragraphs)).not.toContain('{{clinic}}');
    expect(res.body.methods).toEqual(['in_person_signed', 'in_person_verbal', 'electronic', 'other']);
  });

  it('needs a session', async () => {
    expect((await request(app).get('/api/patients/consent-document')).status).toBe(401);
  });
});

describe('recording consent', () => {
  it('starts as none, then granted with who recorded it and which text', async () => {
    const { token } = await createUser({ name: 'Dra. Torres' });
    const patient = await createPatient();

    const before = await get(`/api/patients/${patient.id}/consents`, token);
    expect(before.body).toMatchObject({ status: 'none', upToDate: false, current: null, history: [] });

    const res = await give(token, patient.id);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'granted', upToDate: true, currentVersion: CURRENT_CONSENT_VERSION });
    expect(res.body.current).toMatchObject({
      granted: true,
      documentVersion: CURRENT_CONSENT_VERSION,
      method: 'in_person_signed',
      recordedBy: { name: 'Dra. Torres', role: 'doctor' }
    });
    expect(res.body.history).toHaveLength(1);
  });

  it('keeps every event: giving then withdrawing leaves two rows and the status follows the latest', async () => {
    const { token } = await createUser();
    const patient = await createPatient();

    await give(token, patient.id);
    const res = await give(token, patient.id, { granted: false, method: 'in_person_verbal' });

    expect(res.body.status).toBe('withdrawn');
    expect(res.body.upToDate).toBe(false);
    expect(res.body.history.map((e) => e.granted)).toEqual([false, true]);
    expect(await prisma.patientConsent.count({ where: { patientId: patient.id } })).toBe(2);
  });

  it('a consent given again after withdrawing is granted again', async () => {
    const { token } = await createUser();
    const patient = await createPatient();
    await give(token, patient.id);
    await give(token, patient.id, { granted: false, method: 'other' });

    const res = await give(token, patient.id, { method: 'electronic' });

    expect(res.body).toMatchObject({ status: 'granted', upToDate: true });
    expect(res.body.history).toHaveLength(3);
  });

  it('shows a consent given to an older text as out of date', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    await prisma.patientConsent.create({
      data: {
        clinicId: user.clinicId, patientId: patient.id, granted: true, documentVersion: '2020-01-v0', method: 'in_person_signed',
        recordedById: user.id, recordedByName: user.name, recordedByRole: user.role
      }
    });

    const res = await get(`/api/patients/${patient.id}/consents`, token);

    expect(res.body).toMatchObject({ status: 'granted', upToDate: false });
    expect(res.body.current.documentVersion).toBe('2020-01-v0');
  });

  it.each([
    ['no granted', { granted: undefined }],
    ['granted as text', { granted: 'true' }],
    ['unknown method', { method: 'telepathy' }],
    ['no method', { method: undefined }]
  ])('rejects %s', async (_label, body) => {
    const { token } = await createUser();
    const patient = await createPatient();

    const res = await give(token, patient.id, body);

    expect(res.status).toBe(400);
    expect(await prisma.patientConsent.count()).toBe(0);
  });

  it('refuses a consent for a text that is no longer the one in force', async () => {
    const { token } = await createUser();
    const patient = await createPatient();

    const res = await give(token, patient.id, { documentVersion: '1999-v0' });

    expect(res.status).toBe(409);
    expect(await prisma.patientConsent.count()).toBe(0);
  });

  it('accepts the version in force when it is sent', async () => {
    const { token } = await createUser();
    const patient = await createPatient();

    expect((await give(token, patient.id, { documentVersion: CURRENT_CONSENT_VERSION })).status).toBe(201);
  });

  it('is written to the audit log when an admin does it, without any patient data', async () => {
    const admin = await createUser({ role: 'admin', name: 'Admin Torres' });
    const patient = await createPatient({ name: 'María Secreta', phone: '+593990000111' });

    await give(admin.token, patient.id);

    const entries = await prisma.auditLog.findMany({ where: { entity: 'consent' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'create', entityId: patient.id, actorName: 'Admin Torres' });
    expect(entries[0].changes).toEqual({
      granted: { to: true },
      documentVersion: { to: CURRENT_CONSENT_VERSION },
      method: { to: 'in_person_signed' }
    });
    expect(JSON.stringify(entries)).not.toMatch(/María|Secreta|111/);
  });

  it('goes away with a patient created by mistake (deleting does not fail because of it)', async () => {
    const admin = await createUser({ role: 'admin' });
    const patient = await createPatient();
    await give(admin.token, patient.id);

    const res = await request(app).delete(`/api/patients/${patient.id}`).set(bearer(admin.token));

    expect(res.status).toBe(200);
    expect(await prisma.patientConsent.count()).toBe(0);
  });
});

describe('between clinics', () => {
  it('answers 404 for a patient of another clinic, to read and to record, and writes nothing', async () => {
    const other = await createClinic({ name: 'Otro consultorio' });
    const stranger = await createUser({ clinic: other });
    const patient = await createPatient();

    expect((await get(`/api/patients/${patient.id}/consents`, stranger.token)).status).toBe(404);
    expect((await give(stranger.token, patient.id)).status).toBe(404);
    expect((await get(`/api/patients/${patient.id}/export`, (await createUser({ clinic: other, role: 'admin' })).token)).status).toBe(404);
    expect(await prisma.patientConsent.count()).toBe(0);
  });

  it('the database itself refuses a consent that links a patient to another clinic', async () => {
    const other = await createClinic();
    const { user } = await createUser();
    const patient = await createPatient();

    await expect(
      prisma.patientConsent.create({
        data: { clinicId: other.id, patientId: patient.id, granted: true, documentVersion: 'v', method: 'other', recordedById: user.id, recordedByName: 'x', recordedByRole: 'doctor' }
      })
    ).rejects.toThrow();
  });
});

describe('consent in the patient list', () => {
  it('tells each patient\'s standing in the same response', async () => {
    const { token } = await createUser();
    const agreed = await createPatient({ name: 'A Con consentimiento' });
    const withdrew = await createPatient({ name: 'B Retiró' });
    const pending = await createPatient({ name: 'C Pendiente' });
    await give(token, agreed.id);
    await give(token, withdrew.id);
    await give(token, withdrew.id, { granted: false, method: 'other' });

    const res = await get('/api/patients?pageSize=10', token);

    const byName = Object.fromEntries(res.body.patients.map((p) => [p.name, p.consent]));
    expect(byName['A Con consentimiento']).toMatchObject({ status: 'granted', upToDate: true });
    expect(byName['B Retiró']).toMatchObject({ status: 'withdrawn', upToDate: false });
    expect(byName['C Pendiente']).toEqual({ status: 'none', upToDate: false });
    expect(pending.id).toBeDefined();
  });
});

describe('GET /api/patients/:id/export', () => {
  async function setup() {
    const admin = await createUser({ role: 'admin', name: 'Admin' });
    const doctor = await createUser({ name: 'Dra. Torres', email: 'torres@example.test' });
    const patient = await createPatient({ name: 'María Andrade', cedula: '1700000001', email: 'maria@example.test' });
    await createAppointment({ doctor: doctor.user, patient, date: TUESDAY, time: '10:00', status: 'confirmed', notes: 'Dolor de cabeza' });
    return { admin, doctor, patient };
  }

  it('gives an admin the patient\'s data, appointments, messages and consent, as a download', async () => {
    const { admin, patient } = await setup();
    await give(admin.token, patient.id);

    const res = await get(`/api/patients/${patient.id}/export`, admin.token);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="patient-${patient.id}.json"`);
    expect(res.body.patient).toMatchObject({ id: patient.id, name: 'María Andrade', cedula: '1700000001', email: 'maria@example.test' });
    expect(res.body.appointments).toEqual([
      expect.objectContaining({ date: TUESDAY, time: '10:00', status: 'confirmed', notes: 'Dolor de cabeza', doctor: 'Dra. Torres' })
    ]);
    expect(res.body.healthDataConsent).toMatchObject({ status: 'granted', currentVersion: CURRENT_CONSENT_VERSION });
    expect(res.body.healthDataConsent.events).toHaveLength(1);
    expect(res.body.messagesSent).toEqual([]);
  });

  it('lists the messages sent to the patient without text and with the destination masked', async () => {
    const { admin, patient, doctor } = await setup();
    const appointment = await prisma.appointment.findFirst({ where: { patientId: patient.id } });
    await prisma.notificationLog.createMany({
      data: [
        { clinicId: admin.user.clinicId, appointmentId: appointment.id, kind: 'appointment_confirmation', channel: 'whatsapp', provider: 'meta', recipient: 'patient', status: 'sent', destination: '+593***001' },
        { clinicId: admin.user.clinicId, appointmentId: appointment.id, kind: 'doctor_new_appointment', channel: 'email', provider: 'brevo', recipient: 'doctor', status: 'sent', destination: 'to******@example.test' }
      ]
    });

    const res = await get(`/api/patients/${patient.id}/export`, admin.token);

    expect(res.body.messagesSent).toHaveLength(1);
    expect(res.body.messagesSent[0]).toMatchObject({ kind: 'appointment_confirmation', channel: 'whatsapp', status: 'sent', destination: '+593***001' });
    expect(doctor.user.id).toBeDefined();
  });

  it('is only for admins: a secretary, a doctor and a missing session are refused', async () => {
    const { patient } = await setup();
    const secretary = await createUser({ role: 'secretary' });
    const doctor = await createUser();

    expect((await get(`/api/patients/${patient.id}/export`, secretary.token)).status).toBe(403);
    expect((await get(`/api/patients/${patient.id}/export`, doctor.token)).status).toBe(403);
    expect((await request(app).get(`/api/patients/${patient.id}/export`)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { entity: 'patient_export' } })).toBe(0);
  });

  it('leaves a trace in the audit log of who exported whom, with no patient data in it', async () => {
    const { admin, patient } = await setup();

    await get(`/api/patients/${patient.id}/export`, admin.token);

    const entries = await prisma.auditLog.findMany({ where: { entity: 'patient_export' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'read', entityId: patient.id, actorName: 'Admin', clinicId: admin.user.clinicId });
    expect(JSON.stringify(entries)).not.toMatch(/María|1700000001/);
  });

  it('answers 404 for an unknown patient', async () => {
    const { admin } = await setup();

    expect((await get('/api/patients/00000000-0000-4000-8000-0000000000ff/export', admin.token)).status).toBe(404);
  });
});
