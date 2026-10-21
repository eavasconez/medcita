const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { MONDAY } = require('./helpers/time');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const list = (token, query = '') => request(app).get(`/api/appointment-types${query}`).set(bearer(token));
const create = (token, body) => request(app).post('/api/appointment-types').set(bearer(token)).send(body);
const update = (token, id, body) => request(app).put(`/api/appointment-types/${id}`).set(bearer(token)).send(body);
const archive = (token, id) => request(app).delete(`/api/appointment-types/${id}`).set(bearer(token));

const FIRST_VISIT = { name: 'Primera vez', durationMinutes: 40, color: '#F97316' };

describe('GET /api/appointment-types', () => {
  it('gives every clinic its default 30-minute type the first time, and never a second one', async () => {
    const { token } = await createUser();

    const first = await list(token);
    const second = await list(token);

    expect(first.status).toBe(200);
    expect(first.body).toEqual([
      { id: expect.any(String), name: 'Consultation', durationMinutes: 30, color: '#0ea5e9', isDefault: true, active: true }
    ]);
    expect(second.body).toEqual(first.body);
    expect(await prisma.appointmentType.count()).toBe(1);
  });

  it('is open to every role of the clinic, default first and then by name', async () => {
    const admin = await createUser({ role: 'admin' });
    await create(admin.token, { name: 'Control', durationMinutes: 20 });
    await create(admin.token, { name: 'Ecografía', durationMinutes: 45 });

    for (const role of ['doctor', 'secretary', 'admin']) {
      const user = await createUser({ role, clinic: { id: admin.user.clinicId } });
      const res = await list(user.token);
      expect(res.status).toBe(200);
      expect(res.body.map((t) => t.name)).toEqual(['Consultation', 'Control', 'Ecografía']);
    }
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/appointment-types')).status).toBe(401);
  });

  it('shows only the types of the caller\'s clinic', async () => {
    const mine = await createUser({ role: 'admin' });
    const other = await createUser({ role: 'admin', clinic: await createClinic() });
    await create(other.token, FIRST_VISIT);

    const res = await list(mine.token);

    expect(res.body.map((t) => t.name)).toEqual(['Consultation']);
  });

  it('leaves archived types out, unless an admin asks for them', async () => {
    const admin = await createUser({ role: 'admin' });
    const doctor = await createUser({ clinic: { id: admin.user.clinicId } });
    const type = (await create(admin.token, FIRST_VISIT)).body;
    await archive(admin.token, type.id);

    expect((await list(admin.token)).body.map((t) => t.name)).toEqual(['Consultation']);
    expect((await list(admin.token, '?includeArchived=true')).body.map((t) => t.name)).toEqual(['Consultation', 'Primera vez']);
    // a doctor cannot ask for them
    expect((await list(doctor.token, '?includeArchived=true')).body.map((t) => t.name)).toEqual(['Consultation']);
  });
});

describe('POST /api/appointment-types', () => {
  it('creates a type, tidying the name and the color, and records it in the audit log', async () => {
    const admin = await createUser({ role: 'admin' });

    const res = await create(admin.token, { name: '  Primera   vez ', durationMinutes: 40, color: '#F97316' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), name: 'Primera vez', durationMinutes: 40, color: '#f97316', isDefault: false, active: true });
    const entry = await prisma.auditLog.findFirst({ where: { entity: 'appointment_type', entityId: res.body.id } });
    expect(entry).toMatchObject({ action: 'create', actorId: admin.user.id, clinicId: admin.user.clinicId });
    expect(entry.changes).toEqual({ name: { to: 'Primera vez' }, durationMinutes: { to: 40 }, color: { to: '#f97316' }, active: { to: true } });
  });

  it('uses the default color when none is given', async () => {
    const admin = await createUser({ role: 'admin' });

    const res = await create(admin.token, { name: 'Control', durationMinutes: 20 });

    expect(res.body.color).toBe('#0ea5e9');
  });

  it.each([
    ['a name that is too short', { name: 'A', durationMinutes: 20 }, /name must be between 2 and 40/],
    ['a name that is too long', { name: 'x'.repeat(41), durationMinutes: 20 }, /name must be between 2 and 40/],
    ['no name', { durationMinutes: 20 }, /name must be between 2 and 40/],
    ['no duration', { name: 'Control' }, /durationMinutes must be/],
    ['a duration below 5 minutes', { name: 'Control', durationMinutes: 0 }, /durationMinutes must be/],
    ['a duration above 4 hours', { name: 'Control', durationMinutes: 245 }, /durationMinutes must be/],
    ['a duration that is not a multiple of 5', { name: 'Control', durationMinutes: 17 }, /durationMinutes must be/],
    ['a duration that is text', { name: 'Control', durationMinutes: '20' }, /durationMinutes must be/],
    ['a color that is not hex', { name: 'Control', durationMinutes: 20, color: 'red' }, /color must be a hex color/],
    ['a short hex color', { name: 'Control', durationMinutes: 20, color: '#fff' }, /color must be a hex color/]
  ])('rejects %s', async (_label, body, message) => {
    const admin = await createUser({ role: 'admin' });

    const res = await create(admin.token, body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await prisma.appointmentType.count({ where: { clinicId: admin.user.clinicId, isDefault: false } })).toBe(0);
  });

  it('refuses a second type with the same name in the clinic, but lets another clinic use it', async () => {
    const admin = await createUser({ role: 'admin' });
    const other = await createUser({ role: 'admin', clinic: await createClinic() });
    await create(admin.token, FIRST_VISIT);

    expect((await create(admin.token, FIRST_VISIT)).status).toBe(409);
    expect((await create(admin.token, { ...FIRST_VISIT, name: 'Consultation' })).status).toBe(409);
    expect((await create(other.token, FIRST_VISIT)).status).toBe(201);
  });

  it('stops at 30 types per clinic', async () => {
    const admin = await createUser({ role: 'admin' });
    await list(admin.token); // the default one is the first of the 30
    await prisma.appointmentType.createMany({
      data: Array.from({ length: 29 }, (_, i) => ({ clinicId: admin.user.clinicId, name: `Tipo ${i}`, durationMinutes: 20, color: '#0ea5e9' }))
    });

    const res = await create(admin.token, FIRST_VISIT);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A clinic can have at most 30 appointment types');
  });

  it('is for admins only', async () => {
    const { user } = await createUser({ role: 'admin' });
    for (const role of ['doctor', 'secretary']) {
      const who = await createUser({ role, clinic: { id: user.clinicId } });
      expect((await create(who.token, FIRST_VISIT)).status).toBe(403);
    }
    expect((await request(app).post('/api/appointment-types').send(FIRST_VISIT)).status).toBe(401);
  });
});

describe('PUT /api/appointment-types/:id', () => {
  const setup = async () => {
    const admin = await createUser({ role: 'admin' });
    const type = (await create(admin.token, FIRST_VISIT)).body;
    return { admin, type };
  };

  it('changes the name, length and color, and says what changed in the audit log', async () => {
    const { admin, type } = await setup();

    const res = await update(admin.token, type.id, { name: 'Primera consulta', durationMinutes: 45, color: '#22C55E' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Primera consulta', durationMinutes: 45, color: '#22c55e', active: true });
    const entry = await prisma.auditLog.findFirst({ where: { entity: 'appointment_type', entityId: type.id, action: 'update' } });
    expect(entry.changes).toEqual({
      name: { from: 'Primera vez', to: 'Primera consulta' },
      durationMinutes: { from: 40, to: 45 },
      color: { from: '#f97316', to: '#22c55e' }
    });
  });

  it('does not touch the appointments already booked with the old length', async () => {
    const { admin, type } = await setup();
    const doctor = await createUser({ clinic: { id: admin.user.clinicId } });
    const patient = await createPatient({ clinic: { id: admin.user.clinicId } });
    const apt = await createAppointment({ doctor: doctor.user, patient, date: MONDAY, time: '09:00', typeId: type.id, durationMinutes: 40 });

    await update(admin.token, type.id, { durationMinutes: 60 });

    expect((await prisma.appointment.findUnique({ where: { id: apt.id } })).durationMinutes).toBe(40);
  });

  it('archives and brings back a type', async () => {
    const { admin, type } = await setup();

    const off = await update(admin.token, type.id, { active: false });
    const on = await update(admin.token, type.id, { active: true });

    expect(off.body.active).toBe(false);
    expect(on.body.active).toBe(true);
  });

  it('never archives the default type, but it can be renamed and resized', async () => {
    const admin = await createUser({ role: 'admin' });
    const [main] = (await list(admin.token)).body;

    const off = await update(admin.token, main.id, { active: false });
    const edit = await update(admin.token, main.id, { name: 'Consulta general', durationMinutes: 25 });

    expect(off.status).toBe(400);
    expect(off.body.error).toBe('The default appointment type cannot be archived');
    expect(edit.body).toMatchObject({ name: 'Consulta general', durationMinutes: 25, isDefault: true, active: true });
  });

  it.each([
    ['nothing to change', {}, /Send at least one of/],
    ['a bad name', { name: ' ' }, /name must be between/],
    ['a bad duration', { durationMinutes: 7 }, /durationMinutes must be/],
    ['a bad color', { color: 'azul' }, /color must be a hex color/],
    ['a non-boolean active', { active: 'no' }, /active must be true or false/]
  ])('rejects %s', async (_label, body, message) => {
    const { admin, type } = await setup();

    const res = await update(admin.token, type.id, body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('refuses a name another type of the clinic already has', async () => {
    const { admin, type } = await setup();
    await create(admin.token, { name: 'Control', durationMinutes: 20 });

    expect((await update(admin.token, type.id, { name: 'Control' })).status).toBe(409);
  });

  it('answers 404 for a type of another clinic and for one that does not exist', async () => {
    const { type } = await setup();
    const other = await createUser({ role: 'admin', clinic: await createClinic() });

    expect((await update(other.token, type.id, { name: 'Robado' })).status).toBe(404);
    expect((await archive(other.token, type.id)).status).toBe(404);
    expect((await update(other.token, '00000000-0000-4000-8000-0000000000aa', { name: 'Nada' })).status).toBe(404);
    expect((await prisma.appointmentType.findUnique({ where: { id: type.id } })).name).toBe('Primera vez');
  });

  it('is for admins only', async () => {
    const { admin, type } = await setup();
    for (const role of ['doctor', 'secretary']) {
      const who = await createUser({ role, clinic: { id: admin.user.clinicId } });
      expect((await update(who.token, type.id, { name: 'Otro' })).status).toBe(403);
      expect((await archive(who.token, type.id)).status).toBe(403);
    }
  });
});

describe('DELETE /api/appointment-types/:id', () => {
  it('archives the type (the appointments that have it keep it) and is fine to repeat', async () => {
    const admin = await createUser({ role: 'admin' });
    const type = (await create(admin.token, FIRST_VISIT)).body;
    const doctor = await createUser({ clinic: { id: admin.user.clinicId } });
    const patient = await createPatient({ clinic: { id: admin.user.clinicId } });
    const apt = await createAppointment({ doctor: doctor.user, patient, date: MONDAY, time: '09:00', typeId: type.id, durationMinutes: 40 });

    const first = await archive(admin.token, type.id);
    const again = await archive(admin.token, type.id);

    expect(first.status).toBe(200);
    expect(first.body.active).toBe(false);
    expect(again.status).toBe(200);
    expect((await prisma.appointment.findUnique({ where: { id: apt.id } })).typeId).toBe(type.id);
    // one entry for the archiving, not two
    expect(await prisma.auditLog.count({ where: { entity: 'appointment_type', entityId: type.id, action: 'update' } })).toBe(1);
  });

  it('refuses to archive the default type', async () => {
    const admin = await createUser({ role: 'admin' });
    const [main] = (await list(admin.token)).body;

    const res = await archive(admin.token, main.id);

    expect(res.status).toBe(400);
    expect((await list(admin.token)).body).toHaveLength(1);
  });
});

describe('the audit log filter', () => {
  it('accepts appointment_type as an entity', async () => {
    const admin = await createUser({ role: 'admin' });
    await create(admin.token, FIRST_VISIT);

    const res = await request(app).get('/api/admin/audit-log?entity=appointment_type').set(bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
  });
});
