const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, createPatient, createAppointment, bearer, tokenFor } = require('./helpers/factories');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const timeline = (token, patientId, query = '') => request(app).get(`/api/patients/${patientId}/clinical/timeline${query}`).set(bearer(token));
const audit = () => prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
const SECRET = 'Cefalea intensa con fotofobia';

// A patient with a bit of everything, from September to October of 2026 (the clinic is in Ecuador, UTC-5)
async function story() {
  const clinic = await createClinic();
  const doctor = await createUser({ role: 'doctor', clinic, name: 'Dra. Vega' });
  const patient = await createPatient({ clinic });
  const visit1 = await createAppointment({ doctor: doctor.user, patient, date: '2026-09-10', time: '09:00', status: 'completed' });
  const visit2 = await createAppointment({ doctor: doctor.user, patient, date: '2026-10-05', time: '09:00', status: 'confirmed' });
  const base = { clinicId: clinic.id, patientId: patient.id };

  const note = await prisma.consultationNote.create({
    data: {
      ...base, appointmentId: visit1.id, status: 'closed', template: 'blank', authorId: doctor.user.id, authorName: 'Dra. Vega',
      subjective: SECRET, closedAt: new Date('2026-09-10T15:30:00Z'), closedById: doctor.user.id, closedByName: 'Dra. Vega'
    }
  });
  await prisma.consultationDiagnosis.createMany({
    data: [
      { ...base, noteId: note.id, name: 'Migraña', code: null, kind: 'secondary', certainty: 'presumptive', recordedById: doctor.user.id, recordedByName: 'Dra. Vega' },
      { ...base, noteId: note.id, name: 'Cefalea tensional', code: 'G44.2', kind: 'primary', certainty: 'definitive', recordedById: doctor.user.id, recordedByName: 'Dra. Vega' }
    ]
  });
  await prisma.consultationAddendum.create({ data: { clinicId: clinic.id, noteId: note.id, text: 'Se aclara la dosis', authorId: doctor.user.id, authorName: 'Dra. Vega', createdAt: new Date('2026-09-12T10:00:00Z') } });
  const vital = await prisma.patientVitals.create({
    data: { ...base, appointmentId: visit1.id, measuredAt: new Date('2026-09-10T14:20:00Z'), weightKg: 70, heightCm: 170, systolic: 120, diastolic: 80, recordedById: doctor.user.id, recordedByName: 'Dra. Vega' }
  });
  const voided = await prisma.patientVitals.create({
    data: { ...base, measuredAt: new Date('2026-09-20T14:00:00Z'), weightKg: 7, recordedById: doctor.user.id, recordedByName: 'Dra. Vega', voidedAt: new Date(), voidedById: doctor.user.id, voidedByName: 'Dra. Vega' }
  });
  const consent = await prisma.patientConsent.create({
    data: { ...base, granted: true, documentVersion: '2026-10-v1', method: 'in_person_signed', recordedById: doctor.user.id, recordedByName: 'Dra. Vega', recordedByRole: 'doctor', createdAt: new Date('2026-09-01T12:00:00Z') }
  });
  return { clinic, doctor, patient, visit1, visit2, note, vital, voided, consent };
}

describe('the content of the timeline', () => {
  it('lists every kind of event, newest first, each at its moment', async () => {
    const ctx = await story();

    const res = await timeline(ctx.doctor.token, ctx.patient.id);

    expect(res.status).toBe(200);
    expect(res.body.nextBefore).toBeNull();
    expect(res.body.events.map((e) => [e.type, e.at])).toEqual([
      ['appointment', '2026-10-05T14:00:00.000Z'],
      ['vitals', '2026-09-20T14:00:00.000Z'],
      ['addendum', '2026-09-12T10:00:00.000Z'],
      ['note', '2026-09-10T15:30:00.000Z'],
      ['vitals', '2026-09-10T14:20:00.000Z'],
      ['appointment', '2026-09-10T14:00:00.000Z'],
      ['consent', '2026-09-01T12:00:00.000Z']
    ]);
  });

  it('a visit shows its date, time, status, doctor and whether it has a note', async () => {
    const ctx = await story();
    const events = (await timeline(ctx.doctor.token, ctx.patient.id)).body.events;

    const visit = events.find((e) => e.type === 'appointment' && e.id === ctx.visit1.id);
    expect(visit).toMatchObject({ date: '2026-09-10', time: '09:00', status: 'completed', doctor: 'Dra. Vega', noteId: ctx.note.id, appointmentType: null });
    expect(events.find((e) => e.id === ctx.visit2.id).noteId).toBeNull();
  });

  it('a note shows its state and diagnoses (the main first) and never its text', async () => {
    const ctx = await story();
    const res = await timeline(ctx.doctor.token, ctx.patient.id);

    const note = res.body.events.find((e) => e.type === 'note');
    expect(note).toMatchObject({ id: ctx.note.id, status: 'closed', authorName: 'Dra. Vega', closedByName: 'Dra. Vega', addendaCount: 1, visit: '2026-09-10 09:00' });
    expect(note.diagnoses.map((d) => d.name)).toEqual(['Cefalea tensional', 'Migraña']);
    expect(note.diagnoses[0]).toEqual({ code: 'G44.2', name: 'Cefalea tensional', kind: 'primary', certainty: 'definitive' });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('a draft sits at the last time it was touched', async () => {
    const ctx = await story();
    const draftVisit = await createAppointment({ doctor: ctx.doctor.user, patient: ctx.patient, date: '2026-10-06', time: '10:00' });
    const draft = await prisma.consultationNote.create({
      data: { clinicId: ctx.clinic.id, patientId: ctx.patient.id, appointmentId: draftVisit.id, authorId: ctx.doctor.user.id, authorName: 'Dra. Vega' }
    });

    const note = (await timeline(ctx.doctor.token, ctx.patient.id)).body.events.find((e) => e.id === draft.id);

    expect(note).toMatchObject({ status: 'draft', closedByName: null, diagnoses: [], addendaCount: 0 });
    expect(note.at).toBe(draft.updatedAt.toISOString());
  });

  it('an addendum carries its text and its author', async () => {
    const ctx = await story();
    const addendum = (await timeline(ctx.doctor.token, ctx.patient.id)).body.events.find((e) => e.type === 'addendum');
    expect(addendum).toMatchObject({ text: 'Se aclara la dosis', authorName: 'Dra. Vega', noteId: ctx.note.id });
  });

  it('vital signs show their values with the BMI, and a voided one is marked', async () => {
    const ctx = await story();
    const events = (await timeline(ctx.doctor.token, ctx.patient.id)).body.events;

    const reading = events.find((e) => e.id === ctx.vital.id);
    expect(reading).toMatchObject({ type: 'vitals', voided: false, appointmentId: ctx.visit1.id, recordedByName: 'Dra. Vega' });
    expect(reading.reading).toMatchObject({ weightKg: 70, heightCm: 170, systolic: 120, diastolic: 80, heartRate: null, bmi: 24.2 });
    expect(events.find((e) => e.id === ctx.voided.id).voided).toBe(true);
  });

  it('consent events say what was recorded', async () => {
    const ctx = await story();
    await prisma.patientConsent.create({
      data: { clinicId: ctx.clinic.id, patientId: ctx.patient.id, granted: false, documentVersion: '2026-10-v1', method: 'electronic', recordedById: ctx.doctor.user.id, recordedByName: 'Dra. Vega', recordedByRole: 'doctor' }
    });

    const consents = (await timeline(ctx.doctor.token, ctx.patient.id)).body.events.filter((e) => e.type === 'consent');

    expect(consents.map((c) => c.granted)).toEqual([false, true]);
    expect(consents[1]).toMatchObject({ documentVersion: '2026-10-v1', method: 'in_person_signed', recordedByName: 'Dra. Vega' });
  });

  it('has nothing for a patient without a history, and nothing of other patients', async () => {
    const ctx = await story();
    const other = await createPatient({ clinic: ctx.clinic });

    const res = await timeline(ctx.doctor.token, other.id);

    expect(res.body).toEqual({ events: [], nextBefore: null });
  });

  it('puts the appointments at their clinic time, whatever the zone of the clinic is', async () => {
    const ctx = await story();
    await prisma.clinic.update({ where: { id: ctx.clinic.id }, data: { timezone: 'Pacific/Galapagos' } });

    const visit = (await timeline(ctx.doctor.token, ctx.patient.id)).body.events.find((e) => e.id === ctx.visit2.id);

    expect(visit.at).toBe('2026-10-05T15:00:00.000Z'); // 09:00 in UTC-6
  });
});

describe('narrowing and paging', () => {
  it('shows only the types asked for', async () => {
    const ctx = await story();

    const res = await timeline(ctx.doctor.token, ctx.patient.id, '?types=vitals,consent');

    expect(res.body.events.map((e) => e.type).sort()).toEqual(['consent', 'vitals', 'vitals']);
  });

  it.each([['?types='], ['?types=vitals,secrets'], ['?limit=0'], ['?limit=201'], ['?limit=x'], ['?before=yesterday']])(
    'refuses %s', async (query) => {
      const ctx = await story();
      expect((await timeline(ctx.doctor.token, ctx.patient.id, query)).status).toBe(400);
    }
  );

  it('pages from the newest to the oldest without repeating or losing any event', async () => {
    const ctx = await story();
    const everything = (await timeline(ctx.doctor.token, ctx.patient.id)).body.events;
    expect(everything.length).toBeGreaterThanOrEqual(7);

    const seen = [];
    let before = null;
    let pages = 0;
    do {
      const res = await timeline(ctx.doctor.token, ctx.patient.id, `?limit=2${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.events.map((e) => e.id));
      before = res.body.nextBefore;
      pages += 1;
    } while (before && pages < 20);

    expect(seen).toEqual(everything.map((e) => e.id));
    expect(before).toBeNull();
  });

  it('never splits events of the same instant between two pages', async () => {
    const ctx = await story();
    const moment = new Date('2026-09-05T10:00:00Z');
    await prisma.patientVitals.createMany({
      data: [1, 2, 3].map((n) => ({ clinicId: ctx.clinic.id, patientId: ctx.patient.id, measuredAt: moment, weightKg: 60 + n, recordedById: ctx.doctor.user.id, recordedByName: 'Dra. Vega' }))
    });
    const all = (await timeline(ctx.doctor.token, ctx.patient.id)).body.events;
    const index = all.findIndex((e) => e.at === moment.toISOString());

    const page = await timeline(ctx.doctor.token, ctx.patient.id, `?limit=${index + 1}`);

    expect(page.body.events.filter((e) => e.at === moment.toISOString())).toHaveLength(3);
    const rest = await timeline(ctx.doctor.token, ctx.patient.id, `?limit=50&before=${encodeURIComponent(page.body.nextBefore)}`);
    expect([...page.body.events, ...rest.body.events].map((e) => e.id)).toEqual(all.map((e) => e.id));
  });
});

describe('who can see it', () => {
  it.each(['doctor', 'admin'])('a %s can, and the read is audited once per call', async (role) => {
    const ctx = await story();
    const reader = await createUser({ role, clinic: ctx.clinic });

    expect((await timeline(reader.token, ctx.patient.id)).status).toBe(200);
    expect((await timeline(reader.token, ctx.patient.id, '?limit=1')).status).toBe(200);

    const reads = (await audit()).filter((e) => e.action === 'read');
    expect(reads).toHaveLength(2);
    expect(reads[0]).toMatchObject({ entity: 'clinical_record', entityId: ctx.patient.id, actorId: reader.user.id, actorRole: role, changes: { section: { to: 'timeline' } } });
  });

  it('the secretary is refused and nothing is recorded', async () => {
    const ctx = await story();
    const secretary = await createUser({ role: 'secretary', clinic: ctx.clinic });

    expect((await timeline(secretary.token, ctx.patient.id)).status).toBe(403);
    expect(await audit()).toHaveLength(0);
  });

  it.each(['doctor', 'admin', 'secretary'])('a %s of another clinic gets nothing', async (role) => {
    const ctx = await story();
    const outsider = await createUser({ role, clinic: await createClinic() });

    const res = await timeline(outsider.token, ctx.patient.id);

    expect(res.status).toBe(role === 'secretary' ? 403 : 404);
    expect(JSON.stringify(res.body)).not.toContain('Dra. Vega');
  });

  it('a doctor turned secretary is refused with the old token; 401 without a token; 404 for an unknown patient', async () => {
    const ctx = await story();
    const other = await createUser({ role: 'doctor', clinic: ctx.clinic });
    const stale = tokenFor(other.user);
    await prisma.doctor.update({ where: { id: other.user.id }, data: { role: 'secretary' } });

    expect((await timeline(stale, ctx.patient.id)).status).toBe(403);
    expect((await request(app).get(`/api/patients/${ctx.patient.id}/clinical/timeline`)).status).toBe(401);
    expect((await timeline(ctx.doctor.token, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});
