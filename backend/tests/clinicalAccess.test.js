const express = require('express');
const request = require('supertest');
const auth = require('../src/middleware/auth');
const clinicalAccess = require('../src/middleware/clinicalAccess');
const { recordClinicalRead } = require('../src/services/auditLog');
const { inClinic } = require('../src/utils/clinicScope');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, createPatient, tokenFor, bearer } = require('./helpers/factories');

// The clinical routes arrive with S10-02 and later. Until then this probe has the same
// shape they will have: authenticate, check the role, load the patient inside the
// caller's clinic and record the read.
const probe = express();
probe.get('/clinical/patients/:id/:section', auth, clinicalAccess, async (req, res) => {
  const patient = await prisma.patient.findFirst({ where: inClinic(req, { id: req.params.id }) });
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  await recordClinicalRead(prisma, req, { patientId: patient.id, section: req.params.section });
  res.json({ ok: true });
});

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const open = (token, patientId, section = 'notes') =>
  request(probe).get(`/clinical/patients/${patientId}/${section}`).set(bearer(token));
const reads = () => prisma.auditLog.findMany({ where: { action: 'read' }, orderBy: { seq: 'asc' } });

describe('who can open the clinical record', () => {
  it.each(['doctor', 'admin'])('a %s of the clinic can', async (role) => {
    const { token } = await createUser({ role });
    const patient = await createPatient();

    const res = await open(token, patient.id);

    expect(res.status).toBe(200);
  });

  it('the secretary cannot, and nothing is recorded', async () => {
    const { token } = await createUser({ role: 'secretary' });
    const patient = await createPatient();

    const res = await open(token, patient.id);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/clinical data/i);
    expect(await reads()).toHaveLength(0);
  });

  it('answers 401 without a token', async () => {
    const patient = await createPatient();
    expect((await request(probe).get(`/clinical/patients/${patient.id}/notes`)).status).toBe(401);
  });

  it('a token that claims a role the account no longer has is refused', async () => {
    const { user } = await createUser({ role: 'doctor' });
    const oldToken = tokenFor(user);
    await prisma.doctor.update({ where: { id: user.id }, data: { role: 'secretary' } });
    const patient = await createPatient();

    expect((await open(oldToken, patient.id)).status).toBe(403);
  });

  it('a token that claims to be a doctor while the account is a secretary is refused', async () => {
    const { user } = await createUser({ role: 'secretary' });
    const forged = tokenFor({ ...user, role: 'doctor' });
    const patient = await createPatient();

    expect((await open(forged, patient.id)).status).toBe(403);
  });

  it('a deleted account loses access with its old token', async () => {
    const { user, token } = await createUser({ role: 'doctor' });
    const patient = await createPatient();
    await prisma.doctor.delete({ where: { id: user.id } });

    expect((await open(token, patient.id)).status).toBe(401);
  });
});

describe('the clinic boundary', () => {
  it('a doctor of another clinic gets 404 for a patient that exists elsewhere, with no record', async () => {
    const other = await createClinic();
    const { token } = await createUser({ role: 'doctor', clinic: other });
    const patient = await createPatient();

    const res = await open(token, patient.id);

    expect(res.status).toBe(404);
    expect(await reads()).toHaveLength(0);
  });

  it('an admin of another clinic is stopped the same way', async () => {
    const other = await createClinic();
    const { token } = await createUser({ role: 'admin', clinic: other });
    const patient = await createPatient();

    expect((await open(token, patient.id)).status).toBe(404);
  });

  it('a secretary of another clinic is refused by role before the patient is looked up', async () => {
    const other = await createClinic();
    const { token } = await createUser({ role: 'secretary', clinic: other });
    const patient = await createPatient();

    expect((await open(token, patient.id)).status).toBe(403);
  });
});

describe('the audit of reads', () => {
  it.each(['doctor', 'admin'])('records who read what, for a %s', async (role) => {
    const { user, token } = await createUser({ role });
    const patient = await createPatient();

    await open(token, patient.id, 'allergies');

    const [entry, ...rest] = await reads();
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      actorId: user.id,
      actorName: user.name,
      actorRole: role,
      clinicId: user.clinicId,
      entity: 'clinical_record',
      entityId: patient.id,
      changes: { section: { to: 'allergies' } }
    });
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('records every read, also of the same record by the same person', async () => {
    const { token } = await createUser({ role: 'doctor' });
    const patient = await createPatient();

    await open(token, patient.id);
    await open(token, patient.id);

    expect(await reads()).toHaveLength(2);
  });

  it('never stores the patient\'s data in the entry', async () => {
    const { token } = await createUser({ role: 'doctor' });
    const patient = await createPatient({ name: 'Zulema Quispe', cedula: '1712345678' });

    await open(token, patient.id);

    const dump = JSON.stringify(await reads());
    expect(dump).not.toContain('Zulema');
    expect(dump).not.toContain('1712345678');
  });
});
