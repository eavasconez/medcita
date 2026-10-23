const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, createPatient, bearer, tokenFor } = require('./helpers/factories');
const { parseItem, MAX_ITEMS_PER_PATIENT } = require('../src/services/clinicalBackground');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const BODIES = {
  allergies: { substance: 'Penicilina', reaction: 'Urticaria', severity: 'severe' },
  medications: { name: 'Metformina', dose: '850 mg', frequency: 'cada 12 horas' },
  backgrounds: { category: 'surgical', description: 'Apendicectomía', noted: '2019' }
};
const ENTITIES = { allergies: 'patient_allergy', medications: 'patient_medication', backgrounds: 'patient_background' };
const MODELS = { allergies: 'patientAllergy', medications: 'patientMedication', backgrounds: 'patientBackground' };
const KINDS = Object.keys(BODIES);

const url = (patientId, path = '') => `/api/patients/${patientId}/clinical${path}`;
const get = (token, patientId, path) => request(app).get(url(patientId, path)).set(bearer(token));
const post = (token, patientId, kind, body = BODIES[kind]) => request(app).post(url(patientId, `/${kind}`)).set(bearer(token)).send(body);
const put = (token, patientId, kind, id, body) => request(app).put(url(patientId, `/${kind}/${id}`)).set(bearer(token)).send(body);
const del = (token, patientId, kind, id) => request(app).delete(url(patientId, `/${kind}/${id}`)).set(bearer(token));
const audit = () => prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
const reads = async () => (await audit()).filter((e) => e.action === 'read');

// An entry of `kind` straight in the database
const seedItem = (kind, patient, user, overrides = {}) =>
  prisma[MODELS[kind]].create({
    data: { ...BODIES[kind], ...overrides, patientId: patient.id, clinicId: patient.clinicId, recordedById: user.id, recordedByName: user.name }
  });

describe('parseItem', () => {
  it('needs the required fields on create, not on update', () => {
    expect(parseItem('allergies', {}, { creating: true }).error).toMatch(/substance is required/);
    expect(parseItem('allergies', {}, { creating: false })).toEqual({ data: {} });
    expect(parseItem('backgrounds', { description: 'x' }, { creating: true }).error).toMatch(/category is required/);
  });

  it('trims, clears optional fields with an empty string and refuses clearing a required one', () => {
    expect(parseItem('medications', { name: '  Aspirina ', dose: '' }, { creating: true }).data).toEqual({ name: 'Aspirina', dose: null });
    expect(parseItem('medications', { name: '  ' }, { creating: false }).error).toMatch(/name is required/);
  });

  it.each([
    ['allergies', { substance: 'x', severity: 'deadly' }, /severity must be one of: mild, moderate, severe/],
    ['allergies', { substance: 'x'.repeat(121) }, /at most 120/],
    ['allergies', { substance: 'x', active: 'yes' }, /true or false/],
    ['allergies', { substance: 5 }, /must be text/],
    ['backgrounds', { category: 'other', description: 'x' }, /category must be one of: personal, family, surgical, habit/],
    ['backgrounds', { category: 'habit', description: 'x'.repeat(501) }, /at most 500/]
  ])('rejects %s %j', (kind, body, message) => {
    expect(parseItem(kind, body, { creating: true }).error).toMatch(message);
  });
});

describe.each(KINDS)('%s', (kind) => {
  it.each(['doctor', 'admin'])('a %s can add, list, change and remove an entry', async (role) => {
    const { token } = await createUser({ role });
    const patient = await createPatient();

    const created = await post(token, patient.id, kind);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject(BODIES[kind]);

    const list = await get(token, patient.id, `/${kind}`);
    expect(list.body.map((r) => r.id)).toEqual([created.body.id]);

    const edited = await put(token, patient.id, kind, created.body.id, kind === 'backgrounds' ? { noted: '2020' } : { active: false });
    expect(edited.status).toBe(200);

    expect((await del(token, patient.id, kind, created.body.id)).status).toBe(200);
    expect(await prisma[MODELS[kind]].count()).toBe(0);
  });

  it('the secretary is refused on every route and nothing changes', async () => {
    const { token } = await createUser({ role: 'secretary' });
    const doctor = await createUser({ role: 'doctor' });
    const patient = await createPatient();
    const item = await seedItem(kind, patient, doctor.user);

    for (const res of [
      await get(token, patient.id, `/${kind}`),
      await post(token, patient.id, kind),
      await put(token, patient.id, kind, item.id, { active: true }),
      await del(token, patient.id, kind, item.id)
    ]) {
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(BODIES[kind][Object.keys(BODIES[kind])[0]]);
    }
    expect(await prisma[MODELS[kind]].count()).toBe(1);
    expect(await audit()).toHaveLength(0);
  });

  it.each(['doctor', 'admin', 'secretary'])('a %s of another clinic gets nothing and changes nothing', async (role) => {
    const owner = await createUser({ role: 'doctor' });
    const patient = await createPatient();
    const item = await seedItem(kind, patient, owner.user);
    const outsider = await createUser({ role, clinic: await createClinic() });

    const statuses = [
      (await get(outsider.token, patient.id, `/${kind}`)).status,
      (await post(outsider.token, patient.id, kind)).status,
      (await put(outsider.token, patient.id, kind, item.id, { active: false })).status,
      (await del(outsider.token, patient.id, kind, item.id)).status
    ];

    expect(statuses).toEqual(role === 'secretary' ? [403, 403, 403, 403] : [404, 404, 404, 404]);
    expect(await prisma[MODELS[kind]].count()).toBe(1);
    expect(await audit()).toHaveLength(0);
  });

  it('an entry of one patient cannot be reached through another patient of the same clinic', async () => {
    const { token, user } = await createUser();
    const patient = await createPatient();
    const other = await createPatient();
    const item = await seedItem(kind, patient, user);

    expect((await put(token, other.id, kind, item.id, { active: false })).status).toBe(404);
    expect((await del(token, other.id, kind, item.id)).status).toBe(404);
    expect((await get(token, other.id, `/${kind}`)).body).toEqual([]);
  });

  it('answers 401 without a token, 404 for an unknown patient or entry, 400 for a bad body', async () => {
    const { token } = await createUser();
    const patient = await createPatient();
    expect((await request(app).get(url(patient.id, `/${kind}`))).status).toBe(401);
    expect((await get(token, '00000000-0000-0000-0000-000000000000', `/${kind}`)).status).toBe(404);
    expect((await put(token, patient.id, kind, '00000000-0000-0000-0000-000000000000', {})).status).toBe(404);
    expect((await post(token, patient.id, kind, {})).status).toBe(400);
  });

  it('keeps who recorded it', async () => {
    const { token, user } = await createUser({ name: 'Dra. Vega' });
    const patient = await createPatient();

    const res = await post(token, patient.id, kind);

    expect(res.body).toMatchObject({ recordedById: user.id, recordedByName: 'Dra. Vega' });
  });

  it('refuses entry number 101', async () => {
    const { token, user } = await createUser();
    const patient = await createPatient();
    await prisma[MODELS[kind]].createMany({
      data: Array.from({ length: MAX_ITEMS_PER_PATIENT }, () => ({
        ...BODIES[kind], patientId: patient.id, clinicId: patient.clinicId, recordedById: user.id, recordedByName: user.name
      }))
    });

    const res = await post(token, patient.id, kind);

    expect(res.status).toBe(409);
    expect(await prisma[MODELS[kind]].count()).toBe(MAX_ITEMS_PER_PATIENT);
  });

  describe('the audit', () => {
    it('records a doctor creating, changing and deleting, without the content', async () => {
      const { user, token } = await createUser({ role: 'doctor' });
      const patient = await createPatient();

      const created = await post(token, patient.id, kind);
      await put(token, patient.id, kind, created.body.id, kind === 'backgrounds' ? { description: 'Texto secreto nuevo' } : kind === 'allergies' ? { substance: 'Texto secreto nuevo', active: false } : { name: 'Texto secreto nuevo', active: false });
      await del(token, patient.id, kind, created.body.id);

      const entries = await audit();
      expect(entries.map((e) => e.action)).toEqual(['create', 'update', 'delete']);
      for (const entry of entries) {
        expect(entry).toMatchObject({ entity: ENTITIES[kind], entityId: created.body.id, actorId: user.id, actorRole: 'doctor', clinicId: user.clinicId });
        expect(entry.changes.patientId.to ?? entry.changes.patientId.from).toBe(patient.id);
      }
      const dump = JSON.stringify(entries);
      for (const secret of ['Penicilina', 'Urticaria', 'Metformina', 'Apendicectomía', 'Texto secreto nuevo']) expect(dump).not.toContain(secret);
    });

    it('records nothing when an update changes nothing', async () => {
      const { token, user } = await createUser();
      const patient = await createPatient();
      const item = await seedItem(kind, patient, user);

      await put(token, patient.id, kind, item.id, BODIES[kind]);

      expect(await audit()).toHaveLength(0);
    });

    it.each(['doctor', 'admin'])('records every list read by a %s', async (role) => {
      const { user, token } = await createUser({ role });
      const patient = await createPatient();

      await get(token, patient.id, `/${kind}`);
      await get(token, patient.id, `/${kind}`);

      const entries = await reads();
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ entity: 'clinical_record', entityId: patient.id, actorId: user.id, actorRole: role, changes: { section: { to: kind } } });
    });
  });
});

describe('allergies', () => {
  it('lists active first, the worst first, then the newest', async () => {
    const { token, user } = await createUser();
    const patient = await createPatient();
    await seedItem('allergies', patient, user, { substance: 'Polvo', severity: 'mild' });
    await seedItem('allergies', patient, user, { substance: 'Mariscos', severity: 'severe', active: false });
    await seedItem('allergies', patient, user, { substance: 'Penicilina', severity: 'severe' });
    await seedItem('allergies', patient, user, { substance: 'Látex', severity: 'moderate' });

    const res = await get(token, patient.id, '/allergies');

    expect(res.body.map((a) => a.substance)).toEqual(['Penicilina', 'Látex', 'Polvo', 'Mariscos']);
  });

  it('keeps a resolved allergy with active false', async () => {
    const { token } = await createUser();
    const patient = await createPatient();
    const created = await post(token, patient.id, 'allergies');

    await put(token, patient.id, 'allergies', created.body.id, { active: false });

    expect((await get(token, patient.id, '/allergies')).body[0]).toMatchObject({ substance: 'Penicilina', active: false });
  });
});

describe('GET /clinical/summary', () => {
  it('gives the three lists with one audit entry', async () => {
    const { token, user } = await createUser();
    const patient = await createPatient();
    for (const kind of KINDS) await seedItem(kind, patient, user);

    const res = await get(token, patient.id, '/summary');

    expect(res.status).toBe(200);
    expect(res.body.allergies).toHaveLength(1);
    expect(res.body.medications).toHaveLength(1);
    expect(res.body.backgrounds).toHaveLength(1);
    const entries = await reads();
    expect(entries).toHaveLength(1);
    expect(entries[0].changes).toEqual({ section: { to: 'summary' } });
  });

  it('is refused to the secretary and to another clinic', async () => {
    const patient = await createPatient();
    const secretary = await createUser({ role: 'secretary' });
    const outsider = await createUser({ role: 'doctor', clinic: await createClinic() });

    expect((await get(secretary.token, patient.id, '/summary')).status).toBe(403);
    expect((await get(outsider.token, patient.id, '/summary')).status).toBe(404);
    expect(await audit()).toHaveLength(0);
  });

  it('refuses a token that still says doctor after the account became a secretary', async () => {
    const { user } = await createUser({ role: 'doctor' });
    const stale = tokenFor(user);
    await prisma.doctor.update({ where: { id: user.id }, data: { role: 'secretary' } });
    const patient = await createPatient();

    expect((await get(stale, patient.id, '/summary')).status).toBe(403);
  });
});

describe('a patient with clinical data', () => {
  it.each(KINDS)('cannot be deleted (%s)', async (kind) => {
    const { token, user } = await createUser({ role: 'admin' });
    const patient = await createPatient();
    await seedItem(kind, patient, user);

    const res = await request(app).delete(`/api/patients/${patient.id}`).set(bearer(token));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/clinical data/);
    expect(await prisma.patient.count()).toBe(1);
    expect(await prisma[MODELS[kind]].count()).toBe(1);
  });

  it('the database itself refuses it too', async () => {
    const { user } = await createUser();
    const patient = await createPatient();
    await seedItem('allergies', patient, user);

    await expect(prisma.patient.delete({ where: { id: patient.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('is exported with its clinical data', async () => {
    const admin = await createUser({ role: 'admin' });
    const patient = await createPatient();
    for (const kind of KINDS) await seedItem(kind, patient, admin.user);

    const res = await request(app).get(`/api/patients/${patient.id}/export`).set(bearer(admin.token));

    expect(res.body.allergies[0].substance).toBe('Penicilina');
    expect(res.body.medications[0].name).toBe('Metformina');
    expect(res.body.backgrounds[0].description).toBe('Apendicectomía');
  });
});

describe('the clinic boundary in the database', () => {
  it('refuses an allergy that points at a patient of another clinic', async () => {
    const other = await createClinic();
    const { user } = await createUser();
    const patient = await createPatient();

    await expect(prisma.patientAllergy.create({
      data: { substance: 'x', patientId: patient.id, clinicId: other.id, recordedById: user.id, recordedByName: user.name }
    })).rejects.toMatchObject({ code: 'P2003' });
  });
});
