const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, createPatient, createAppointment, bearer, tokenFor } = require('./helpers/factories');
const { MONDAY } = require('./helpers/time');
const { parseSections, hasNoContent, sectionsOf, MAX_SECTION_LENGTH, MAX_ADDENDUM_LENGTH } = require('../src/services/consultationNotes');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const base = (patientId, path = '') => `/api/patients/${patientId}/clinical/notes${path}`;
const get = (token, patientId, path) => request(app).get(base(patientId, path)).set(bearer(token));
const start = (token, patientId, body) => request(app).post(base(patientId)).set(bearer(token)).send(body);
const save = (token, patientId, noteId, body) => request(app).put(base(patientId, `/${noteId}`)).set(bearer(token)).send(body);
const close = (token, patientId, noteId, body) => request(app).post(base(patientId, `/${noteId}/close`)).set(bearer(token)).send(body);
const addendum = (token, patientId, noteId, body) => request(app).post(base(patientId, `/${noteId}/addenda`)).set(bearer(token)).send(body);
const remove = (token, patientId, noteId) => request(app).delete(base(patientId, `/${noteId}`)).set(bearer(token));
const audit = () => prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
const reads = async () => (await audit()).filter((e) => e.action === 'read');

const SECRET = 'Cefalea intensa con fotofobia';

// A clinic with a doctor, a patient and one of the patient's appointments
async function setup() {
  const clinic = await createClinic();
  const doctor = await createUser({ role: 'doctor', clinic, name: 'Dra. Vega' });
  const patient = await createPatient({ clinic });
  const appointment = await createAppointment({ doctor: doctor.user, patient, date: MONDAY, time: '09:00', status: 'in_progress' });
  return { clinic, doctor, patient, appointment };
}

async function openNote(ctx, template = 'blank') {
  const res = await start(ctx.doctor.token, ctx.patient.id, { appointmentId: ctx.appointment.id, template });
  return res.body;
}

describe('the service', () => {
  it('parses only the sections that were sent', () => {
    expect(parseSections({ plan: 'Reposo', other: 'x' })).toEqual({ data: { plan: 'Reposo' } });
    expect(parseSections({})).toEqual({ data: {} });
  });

  it('refuses non-text and too long sections', () => {
    expect(parseSections({ subjective: 5 }).error).toMatch(/must be text/);
    expect(parseSections({ objective: 'x'.repeat(MAX_SECTION_LENGTH + 1) }).error).toMatch(/at most 10000/);
    expect(parseSections({ objective: 'x'.repeat(MAX_SECTION_LENGTH) }).error).toBeUndefined();
  });

  it('a note with only its template headings has no content', () => {
    expect(hasNoContent({ template: 'general', ...sectionsOf('general') })).toBe(true);
    expect(hasNoContent({ template: 'general', ...sectionsOf('general'), plan: `${sectionsOf('general').plan}Reposo` })).toBe(false);
    expect(hasNoContent({ template: 'blank', ...sectionsOf('blank'), subjective: '   ' })).toBe(true);
  });
});

describe('who can reach the notes', () => {
  it('lists the templates for a doctor and an admin', async () => {
    const ctx = await setup();
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic });
    for (const token of [ctx.doctor.token, admin.token]) {
      const res = await get(token, ctx.patient.id, '/templates');
      expect(res.status).toBe(200);
      expect(res.body.map((t) => t.id)).toEqual(['general', 'pediatrics', 'blank']);
    }
  });

  it('the secretary is refused on every route and nothing changes', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    const secretary = await createUser({ role: 'secretary', clinic: ctx.clinic });
    const before = (await audit()).length;

    const responses = [
      await get(secretary.token, ctx.patient.id),
      await get(secretary.token, ctx.patient.id, `/${note.id}`),
      await get(secretary.token, ctx.patient.id, '/templates'),
      await start(secretary.token, ctx.patient.id, { appointmentId: ctx.appointment.id }),
      await save(secretary.token, ctx.patient.id, note.id, { revision: 1, plan: 'x' }),
      await close(secretary.token, ctx.patient.id, note.id, { revision: 1 }),
      await addendum(secretary.token, ctx.patient.id, note.id, { text: 'x' }),
      await remove(secretary.token, ctx.patient.id, note.id)
    ];

    for (const res of responses) expect(res.status).toBe(403);
    expect(await prisma.consultationNote.count()).toBe(1);
    expect((await audit()).length).toBe(before);
  });

  it.each(['doctor', 'admin', 'secretary'])('a %s of another clinic gets nothing and changes nothing', async (role) => {
    const ctx = await setup();
    const note = await openNote(ctx);
    const outsider = await createUser({ role, clinic: await createClinic() });
    const expected = role === 'secretary' ? 403 : 404;

    for (const res of [
      await get(outsider.token, ctx.patient.id),
      await get(outsider.token, ctx.patient.id, `/${note.id}`),
      await start(outsider.token, ctx.patient.id, { appointmentId: ctx.appointment.id }),
      await save(outsider.token, ctx.patient.id, note.id, { revision: 1, plan: 'x' }),
      await close(outsider.token, ctx.patient.id, note.id, { revision: 1 }),
      await addendum(outsider.token, ctx.patient.id, note.id, { text: 'x' }),
      await remove(outsider.token, ctx.patient.id, note.id)
    ]) expect(res.status).toBe(expected);
    expect(await prisma.consultationNote.count()).toBe(1);
  });

  it('a note cannot be reached through another patient of the same clinic', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    const other = await createPatient({ clinic: ctx.clinic });

    expect((await get(ctx.doctor.token, other.id, `/${note.id}`)).status).toBe(404);
    expect((await save(ctx.doctor.token, other.id, note.id, { revision: 1, plan: 'x' })).status).toBe(404);
    expect((await close(ctx.doctor.token, other.id, note.id, { revision: 1 })).status).toBe(404);
    expect((await addendum(ctx.doctor.token, other.id, note.id, { text: 'x' })).status).toBe(404);
    expect((await remove(ctx.doctor.token, other.id, note.id)).status).toBe(404);
    expect((await get(ctx.doctor.token, other.id)).body).toEqual([]);
  });

  it('a doctor turned secretary loses access with the old token', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    await prisma.doctor.update({ where: { id: ctx.doctor.user.id }, data: { role: 'secretary' } });

    expect((await get(tokenFor({ ...ctx.doctor.user, role: 'doctor' }), ctx.patient.id, `/${note.id}`)).status).toBe(403);
  });

  it('answers 401 without a token', async () => {
    const ctx = await setup();
    expect((await request(app).get(base(ctx.patient.id))).status).toBe(401);
  });
});

describe('starting a note', () => {
  it('starts from the general template, with its author', async () => {
    const ctx = await setup();

    const res = await start(ctx.doctor.token, ctx.patient.id, { appointmentId: ctx.appointment.id, template: 'general' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'draft', revision: 1, template: 'general', authorId: ctx.doctor.user.id, authorName: 'Dra. Vega',
      appointmentId: ctx.appointment.id, patientId: ctx.patient.id
    });
    expect(res.body.subjective).toContain('Motivo de consulta');
    expect(res.body.plan).toContain('Control');
  });

  it('defaults to the general template and knows pediatrics and blank', async () => {
    const ctx = await setup();
    const second = await createAppointment({ doctor: ctx.doctor.user, patient: ctx.patient, date: MONDAY, time: '10:00' });
    const third = await createAppointment({ doctor: ctx.doctor.user, patient: ctx.patient, date: MONDAY, time: '11:00' });

    const general = await start(ctx.doctor.token, ctx.patient.id, { appointmentId: ctx.appointment.id });
    const pediatrics = await start(ctx.doctor.token, ctx.patient.id, { appointmentId: second.id, template: 'pediatrics' });
    const blank = await start(ctx.doctor.token, ctx.patient.id, { appointmentId: third.id, template: 'blank' });

    expect(general.body.template).toBe('general');
    expect(pediatrics.body.subjective).toContain('Vacunas');
    expect(blank.body).toMatchObject({ subjective: '', objective: '', assessment: '', plan: '' });
  });

  it('an admin can write one too', async () => {
    const ctx = await setup();
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic, name: 'Admin Uno' });

    const res = await start(admin.token, ctx.patient.id, { appointmentId: ctx.appointment.id });

    expect(res.status).toBe(201);
    expect(res.body.authorName).toBe('Admin Uno');
  });

  it.each([
    [{}, 400, /appointmentId is required/],
    [{ appointmentId: 5 }, 400, /appointmentId is required/],
    [{ template: 'x', appointmentId: 'a' }, 400, /template must be one of/]
  ])('refuses %j', async (body, status, message) => {
    const ctx = await setup();
    const res = await start(ctx.doctor.token, ctx.patient.id, body);
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(message);
  });

  it('refuses an appointment of another patient, of another clinic, or that does not exist (404)', async () => {
    const ctx = await setup();
    const otherPatient = await createPatient({ clinic: ctx.clinic });
    const otherClinicDoctor = await createUser({ role: 'doctor', clinic: await createClinic() });
    const otherClinicPatient = await createPatient({ clinic: otherClinicDoctor.user.clinicId ? { id: otherClinicDoctor.user.clinicId } : undefined });
    const foreign = await createAppointment({ doctor: otherClinicDoctor.user, patient: otherClinicPatient, date: MONDAY, time: '09:00' });

    expect((await start(ctx.doctor.token, otherPatient.id, { appointmentId: ctx.appointment.id })).status).toBe(404);
    expect((await start(ctx.doctor.token, ctx.patient.id, { appointmentId: foreign.id })).status).toBe(404);
    expect((await start(ctx.doctor.token, ctx.patient.id, { appointmentId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
    expect(await prisma.consultationNote.count()).toBe(0);
  });

  it('refuses a cancelled appointment', async () => {
    const ctx = await setup();
    await prisma.appointment.update({ where: { id: ctx.appointment.id }, data: { status: 'cancelled' } });

    expect((await start(ctx.doctor.token, ctx.patient.id, { appointmentId: ctx.appointment.id })).status).toBe(409);
  });

  it('one note per appointment: the second start says which note exists', async () => {
    const ctx = await setup();
    const first = await openNote(ctx);
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic });

    const res = await start(admin.token, ctx.patient.id, { appointmentId: ctx.appointment.id });

    expect(res.status).toBe(409);
    expect(res.body.noteId).toBe(first.id);
    expect(await prisma.consultationNote.count()).toBe(1);
  });

  it('two doctors starting it at the same time leave one note', async () => {
    const ctx = await setup();
    const other = await createUser({ role: 'doctor', clinic: ctx.clinic });

    const [a, b] = await Promise.all([
      start(ctx.doctor.token, ctx.patient.id, { appointmentId: ctx.appointment.id }),
      start(other.token, ctx.patient.id, { appointmentId: ctx.appointment.id })
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.consultationNote.count()).toBe(1);
  });

  it('is audited, without the text', async () => {
    const ctx = await setup();
    const note = await openNote(ctx, 'general');

    const [entry] = await audit();
    expect(entry).toMatchObject({ action: 'create', entity: 'consultation_note', entityId: note.id, actorId: ctx.doctor.user.id, actorRole: 'doctor' });
    expect(entry.changes).toMatchObject({ patientId: { to: ctx.patient.id }, appointmentId: { to: ctx.appointment.id }, status: { to: 'draft' } });
    expect(JSON.stringify(entry)).not.toContain('Motivo de consulta');
  });
});

describe('saving the draft', () => {
  it('saves the sections sent, keeps the rest and counts the revision', async () => {
    const ctx = await setup();
    const note = await openNote(ctx, 'general');

    const res = await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, subjective: SECRET });

    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(2);
    const stored = await prisma.consultationNote.findUnique({ where: { id: note.id } });
    expect(stored.subjective).toBe(SECRET);
    expect(stored.objective).toBe(note.objective);
    expect(stored.plan).toBe(note.plan);
  });

  it('a stale revision is refused and nothing is overwritten', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, plan: 'Versión A' });

    const res = await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, plan: 'Versión B' });

    expect(res.status).toBe(409);
    expect(res.body.currentRevision).toBe(2);
    expect((await prisma.consultationNote.findUnique({ where: { id: note.id } })).plan).toBe('Versión A');
  });

  it('of two saves at the same time with the same revision exactly one wins', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);

    const results = await Promise.all([
      save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, plan: 'A' }),
      save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, plan: 'B' })
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await prisma.consultationNote.findUnique({ where: { id: note.id } })).revision).toBe(2);
  });

  it('only the author edits: not another doctor, not an admin', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    const colleague = await createUser({ role: 'doctor', clinic: ctx.clinic });
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic });

    for (const user of [colleague, admin]) {
      const res = await save(user.token, ctx.patient.id, note.id, { revision: 1, plan: 'Intruso' });
      expect(res.status).toBe(403);
    }
    expect((await prisma.consultationNote.findUnique({ where: { id: note.id } })).plan).toBe('');
  });

  it.each([
    [{ plan: 'x' }, /revision is required/],
    [{ revision: '1', plan: 'x' }, /revision is required/],
    [{ revision: 0, plan: 'x' }, /revision is required/],
    [{ revision: 1, plan: 5 }, /must be text/],
    [{ revision: 1, plan: 'x'.repeat(MAX_SECTION_LENGTH + 1) }, /at most 10000/]
  ])('refuses %j', async (body, message) => {
    const ctx = await setup();
    const note = await openNote(ctx);
    const res = await save(ctx.doctor.token, ctx.patient.id, note.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('404 for a note that does not exist', async () => {
    const ctx = await setup();
    expect((await save(ctx.doctor.token, ctx.patient.id, '00000000-0000-0000-0000-000000000000', { revision: 1 })).status).toBe(404);
  });

  it('is not logged save by save', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    const before = (await audit()).length;

    await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, plan: SECRET });
    await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 2, plan: `${SECRET} 2` });

    expect((await audit()).length).toBe(before);
  });
});

describe('closing the note', () => {
  async function written(ctx) {
    const note = await openNote(ctx, 'general');
    await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, subjective: SECRET });
    return note;
  }

  it('closes it: nobody edits it again, and who closed it and when are kept', async () => {
    const ctx = await setup();
    const note = await written(ctx);

    const res = await close(ctx.doctor.token, ctx.patient.id, note.id, { revision: 2 });

    expect(res.status).toBe(200);
    const stored = await prisma.consultationNote.findUnique({ where: { id: note.id } });
    expect(stored).toMatchObject({ status: 'closed', closedById: ctx.doctor.user.id, closedByName: 'Dra. Vega' });
    expect(stored.closedAt).toBeInstanceOf(Date);
    expect((await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 3, subjective: 'Cambiado' })).status).toBe(409);
    expect((await prisma.consultationNote.findUnique({ where: { id: note.id } })).subjective).toBe(SECRET);
  });

  it('refuses to close a note with only its template headings, or a blank one', async () => {
    const ctx = await setup();
    const general = await openNote(ctx, 'general');
    const second = await createAppointment({ doctor: ctx.doctor.user, patient: ctx.patient, date: MONDAY, time: '10:00' });
    const blank = (await start(ctx.doctor.token, ctx.patient.id, { appointmentId: second.id, template: 'blank' })).body;

    for (const note of [general, blank]) {
      const res = await close(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Write something/);
    }
    expect(await prisma.consultationNote.count({ where: { status: 'closed' } })).toBe(0);
  });

  it('refuses a stale revision, a second close and a missing revision', async () => {
    const ctx = await setup();
    const note = await written(ctx);

    expect((await close(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1 })).status).toBe(409);
    expect((await close(ctx.doctor.token, ctx.patient.id, note.id, {})).status).toBe(400);
    expect((await close(ctx.doctor.token, ctx.patient.id, note.id, { revision: 2 })).status).toBe(200);
    expect((await close(ctx.doctor.token, ctx.patient.id, note.id, { revision: 3 })).status).toBe(409);
  });

  it('only the author closes it', async () => {
    const ctx = await setup();
    const note = await written(ctx);
    const colleague = await createUser({ role: 'doctor', clinic: ctx.clinic });

    expect((await close(colleague.token, ctx.patient.id, note.id, { revision: 2 })).status).toBe(403);
    expect((await prisma.consultationNote.findUnique({ where: { id: note.id } })).status).toBe('draft');
  });

  it('is audited as a change of status, without the text', async () => {
    const ctx = await setup();
    const note = await written(ctx);

    await close(ctx.doctor.token, ctx.patient.id, note.id, { revision: 2 });

    const entry = (await audit()).find((e) => e.action === 'update');
    expect(entry).toMatchObject({ entity: 'consultation_note', entityId: note.id, actorId: ctx.doctor.user.id });
    expect(entry.changes).toEqual({ patientId: { to: ctx.patient.id }, status: { from: 'draft', to: 'closed' } });
    expect(JSON.stringify(await audit())).not.toContain(SECRET);
  });
});

describe('addenda', () => {
  async function closedNote(ctx) {
    const note = await openNote(ctx);
    await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, assessment: SECRET });
    await close(ctx.doctor.token, ctx.patient.id, note.id, { revision: 2 });
    return note;
  }

  it('any doctor or admin adds one to a closed note, and the note itself does not change', async () => {
    const ctx = await setup();
    const note = await closedNote(ctx);
    const colleague = await createUser({ role: 'doctor', clinic: ctx.clinic, name: 'Dr. Colega' });
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic, name: 'Admin Uno' });
    const before = await prisma.consultationNote.findUnique({ where: { id: note.id } });

    const a = await addendum(colleague.token, ctx.patient.id, note.id, { text: '  Se aclaró la dosis.  ' });
    const b = await addendum(admin.token, ctx.patient.id, note.id, { text: 'Segunda adenda' });

    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ text: 'Se aclaró la dosis.', authorName: 'Dr. Colega', authorId: colleague.user.id });
    expect(b.status).toBe(201);
    expect(await prisma.consultationNote.findUnique({ where: { id: note.id } })).toEqual(before);

    const read = await get(ctx.doctor.token, ctx.patient.id, `/${note.id}`);
    expect(read.body.addenda.map((x) => x.text)).toEqual(['Se aclaró la dosis.', 'Segunda adenda']);
  });

  it('a draft takes no addendum', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);

    expect((await addendum(ctx.doctor.token, ctx.patient.id, note.id, { text: 'x' })).status).toBe(409);
  });

  it.each([
    [{}, /text is required/],
    [{ text: '   ' }, /text is required/],
    [{ text: 5 }, /text is required/],
    [{ text: 'x'.repeat(MAX_ADDENDUM_LENGTH + 1) }, /at most 5000/]
  ])('refuses %j', async (body, message) => {
    const ctx = await setup();
    const note = await closedNote(ctx);
    const res = await addendum(ctx.doctor.token, ctx.patient.id, note.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('cannot be edited or deleted: there is no route for it', async () => {
    const ctx = await setup();
    const note = await closedNote(ctx);
    const { body } = await addendum(ctx.doctor.token, ctx.patient.id, note.id, { text: 'Original' });

    for (const method of ['put', 'delete']) {
      const res = await request(app)[method](base(ctx.patient.id, `/${note.id}/addenda/${body.id}`)).set(bearer(ctx.doctor.token)).send({ text: 'Alterada' });
      expect(res.status).toBe(404);
    }
    expect((await prisma.consultationAddendum.findUnique({ where: { id: body.id } })).text).toBe('Original');
  });

  it('is audited with the patient and the note, without the text', async () => {
    const ctx = await setup();
    const note = await closedNote(ctx);

    const { body } = await addendum(ctx.doctor.token, ctx.patient.id, note.id, { text: 'Texto reservado de adenda' });

    const entry = (await audit()).find((e) => e.entity === 'consultation_addendum');
    expect(entry).toMatchObject({ action: 'create', entityId: body.id });
    expect(entry.changes).toEqual({ patientId: { to: ctx.patient.id }, noteId: { to: note.id } });
    expect(JSON.stringify(await audit())).not.toContain('Texto reservado');
  });
});

describe('deleting a draft', () => {
  it('its author deletes a draft written by mistake, and it is audited', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);

    expect((await remove(ctx.doctor.token, ctx.patient.id, note.id)).status).toBe(200);

    expect(await prisma.consultationNote.count()).toBe(0);
    expect((await audit()).map((e) => e.action)).toEqual(['create', 'delete']);
  });

  it('nobody else deletes it', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic });

    expect((await remove(admin.token, ctx.patient.id, note.id)).status).toBe(403);
    expect(await prisma.consultationNote.count()).toBe(1);
  });

  it('a closed note is never deleted, not even by its author', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, plan: SECRET });
    await close(ctx.doctor.token, ctx.patient.id, note.id, { revision: 2 });

    const res = await remove(ctx.doctor.token, ctx.patient.id, note.id);

    expect(res.status).toBe(409);
    expect(await prisma.consultationNote.count()).toBe(1);
  });

  it('the appointment can then get a fresh note', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    await remove(ctx.doctor.token, ctx.patient.id, note.id);

    expect((await start(ctx.doctor.token, ctx.patient.id, { appointmentId: ctx.appointment.id })).status).toBe(201);
  });
});

describe('reading', () => {
  it('the list has no text and is audited as one read', async () => {
    const ctx = await setup();
    const note = await openNote(ctx, 'general');
    await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, subjective: SECRET });

    const res = await get(ctx.doctor.token, ctx.patient.id);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: note.id, status: 'draft', authorName: 'Dra. Vega', addendaCount: 0, appointment: { date: MONDAY, time: '09:00', doctor: 'Dra. Vega' } });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    const entries = await reads();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entity: 'clinical_record', entityId: ctx.patient.id, changes: { section: { to: 'notes' } } });
  });

  it.each(['doctor', 'admin'])('a %s opening a note sees its text and the read is audited with the note', async (role) => {
    const ctx = await setup();
    const note = await openNote(ctx, 'general');
    await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, subjective: SECRET });
    const reader = await createUser({ role, clinic: ctx.clinic });

    const res = await get(reader.token, ctx.patient.id, `/${note.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subjective: SECRET, revision: 2, status: 'draft', addenda: [] });
    const entries = await reads();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: reader.user.id, actorRole: role, changes: { section: { to: `note:${note.id}` } } });
  });
});

describe('the rest of the system', () => {
  it('a patient with a note cannot be deleted', async () => {
    const ctx = await setup();
    await openNote(ctx);
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic });
    await prisma.appointment.deleteMany({ where: { patientId: ctx.patient.id, id: { not: ctx.appointment.id } } });

    const res = await request(app).delete(`/api/patients/${ctx.patient.id}`).set(bearer(admin.token));

    expect(res.status).toBe(409);
    expect(await prisma.patient.count({ where: { id: ctx.patient.id } })).toBe(1);
  });

  it('the database refuses to delete the appointment or the patient of a note', async () => {
    const ctx = await setup();
    await openNote(ctx);

    await expect(prisma.appointment.delete({ where: { id: ctx.appointment.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.patient.delete({ where: { id: ctx.patient.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('the export of the patient includes the notes with their addenda', async () => {
    const ctx = await setup();
    const note = await openNote(ctx);
    await save(ctx.doctor.token, ctx.patient.id, note.id, { revision: 1, plan: SECRET });
    await close(ctx.doctor.token, ctx.patient.id, note.id, { revision: 2 });
    await addendum(ctx.doctor.token, ctx.patient.id, note.id, { text: 'Adenda' });
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic });

    const res = await request(app).get(`/api/patients/${ctx.patient.id}/export`).set(bearer(admin.token));

    expect(res.body.consultationNotes).toHaveLength(1);
    expect(res.body.consultationNotes[0]).toMatchObject({ plan: SECRET, status: 'closed' });
    expect(res.body.consultationNotes[0].addenda[0].text).toBe('Adenda');
  });

  it('the activity log filter knows the new entities', async () => {
    const ctx = await setup();
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic });
    await openNote(ctx);

    const res = await request(app).get('/api/admin/audit-log?entity=consultation_note').set(bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
  });
});
