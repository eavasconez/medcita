const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createPatient, createAppointment, defaultClinic, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');
const { MONDAY, TUESDAY } = require('./helpers/time');
const { diffFields, describeCreated, describeRemoved } = require('../src/services/auditLog');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

// In the order they were written (entries of one transaction share a timestamp; seq tells them apart)
const entries = () => prisma.auditLog.findMany({ orderBy: [{ createdAt: 'asc' }, { seq: 'asc' }] });
const dump = async () => JSON.stringify(await entries());

const book = (token, body) => request(app).post('/api/appointments').set(bearer(token)).send(body);
const reschedule = (token, id, body) => request(app).put(`/api/appointments/${id}`).set(bearer(token)).send(body);
const cancel = (token, id) => request(app).delete(`/api/appointments/${id}`).set(bearer(token));
const bookingBody = (overrides = {}) => ({
  patientName: 'Zulema Quispe',
  patientPhone: '+593991234567',
  patientEmail: 'zulema@example.test',
  patientCedula: '1712345678',
  date: TUESDAY,
  time: '10:00',
  ...overrides
});

// Appointment of `doctor` made by hand, plus staff accounts to act on it.
async function scene() {
  const doctor = await createUser({ name: 'Dra. Camila Torres' });
  const secretary = await createUser({ role: 'secretary', name: 'Ana Secretaria' });
  const admin = await createUser({ role: 'admin', name: 'Admin Principal' });
  const patient = await createPatient({ name: 'Zulema Quispe', phone: '+593991234567', email: 'zulema@example.test', cedula: '1712345678' });
  const appointment = await createAppointment({ doctor: doctor.user, patient, date: TUESDAY, time: '10:00' });
  return { doctor, secretary, admin, patient, appointment };
}

describe('what is recorded, and who it is recorded for', () => {
  it('records a secretary booking an appointment for another doctor: who, when, what and for which doctor', async () => {
    const doctor = await createUser({ name: 'Dra. Camila Torres' });
    const secretary = await createUser({ role: 'secretary', name: 'Ana Secretaria' });
    const before = Date.now();

    const res = await book(secretary.token, bookingBody({ doctorId: doctor.user.id }));

    expect(res.status).toBe(201);
    const [patientEntry, appointmentEntry] = await entries();
    expect(patientEntry).toMatchObject({ action: 'create', entity: 'patient', entityId: res.body.patientId });
    expect(appointmentEntry).toMatchObject({
      actorId: secretary.user.id,
      actorName: 'Ana Secretaria',
      actorRole: 'secretary',
      action: 'create',
      entity: 'appointment',
      entityId: res.body.id,
      doctorId: doctor.user.id,
      changes: { date: { to: TUESDAY }, time: { to: '10:00' }, status: { to: 'pending_approval' } }
    });
    expect(appointmentEntry.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(appointmentEntry.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('records an admin the same way', async () => {
    const doctor = await createUser();
    const admin = await createUser({ role: 'admin', name: 'Admin Principal' });

    await book(admin.token, bookingBody({ doctorId: doctor.user.id }));

    const appointmentEntry = (await entries()).find((e) => e.entity === 'appointment');
    expect(appointmentEntry).toMatchObject({ actorRole: 'admin', actorName: 'Admin Principal', doctorId: doctor.user.id });
  });

  it('records nothing when a doctor works on their own agenda, patients and account', async () => {
    const { doctor, patient, appointment } = await scene();

    await book(doctor.token, bookingBody({ patientPhone: '+593990000777', patientName: 'Otro Paciente', date: MONDAY }));
    await reschedule(doctor.token, appointment.id, { time: '11:00', notes: 'nota' });
    await cancel(doctor.token, appointment.id);
    await request(app).post('/api/patients').set(bearer(doctor.token)).send({ name: 'Nuevo', phone: '+593990000888' });
    await request(app).put(`/api/patients/${patient.id}`).set(bearer(doctor.token)).send({ name: 'Zulema Q.' });

    expect(await entries()).toEqual([]);
  });
});

describe('appointments edited by staff', () => {
  it('records a move with the before and after of the date and time, for the appointment\'s doctor and not the caller', async () => {
    const { doctor, secretary, appointment } = await scene();

    const res = await reschedule(secretary.token, appointment.id, { date: MONDAY, time: '11:30' });

    expect(res.status).toBe(200);
    expect(await entries()).toEqual([
      expect.objectContaining({
        actorId: secretary.user.id,
        action: 'update',
        entity: 'appointment',
        entityId: appointment.id,
        doctorId: doctor.user.id,
        changes: { date: { from: TUESDAY, to: MONDAY }, time: { from: '10:00', to: '11:30' } }
      })
    ]);
  });

  it('says that the notes changed without copying them', async () => {
    const { admin, appointment } = await scene();

    await reschedule(admin.token, appointment.id, { notes: 'Dolor de pecho desde hace tres días' });

    const [entry] = await entries();
    expect(entry.changes).toEqual({ notes: { changed: true } });
    expect(await dump()).not.toMatch(/Dolor de pecho/);
  });

  it('records a status change, and calls it a cancellation when the new status is cancelled', async () => {
    const { secretary, appointment } = await scene();

    await reschedule(secretary.token, appointment.id, { status: 'confirmed' });
    await reschedule(secretary.token, appointment.id, { status: 'cancelled' });
    await reschedule(secretary.token, appointment.id, { status: 'scheduled' });

    expect((await entries()).map((e) => [e.action, e.changes.status])).toEqual([
      ['update', { from: 'pending_approval', to: 'confirmed' }],
      ['cancel', { from: 'confirmed', to: 'cancelled' }],
      ['update', { from: 'cancelled', to: 'scheduled' }]
    ]);
  });

  it('leaves no record when the request changes nothing', async () => {
    const { secretary, appointment } = await scene();

    const res = await reschedule(secretary.token, appointment.id, { date: TUESDAY, time: '10:00', status: 'pending_approval' });

    expect(res.status).toBe(200);
    expect(await entries()).toEqual([]);
  });

  it('leaves no record when the edit is refused', async () => {
    const { doctor, secretary, patient, appointment } = await scene();
    await createAppointment({ doctor: doctor.user, patient, date: TUESDAY, time: '11:00' });

    const taken = await reschedule(secretary.token, appointment.id, { time: '11:00' });
    const unknown = await reschedule(secretary.token, '00000000-0000-4000-8000-000000000000', { time: '12:00' });

    expect(taken.status).toBe(409);
    expect(unknown.status).toBe(404);
    expect(await entries()).toEqual([]);
  });

  it('records a cancellation once: repeating it changes nothing and leaves no second record', async () => {
    const { doctor, secretary, appointment } = await scene();

    const first = await cancel(secretary.token, appointment.id);
    const second = await cancel(secretary.token, appointment.id);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await entries()).toEqual([
      expect.objectContaining({
        actorId: secretary.user.id,
        action: 'cancel',
        entity: 'appointment',
        entityId: appointment.id,
        doctorId: doctor.user.id,
        changes: { status: { from: 'pending_approval', to: 'cancelled' } }
      })
    ]);
  });

  it('records one cancellation even when two requests arrive at the same time', async () => {
    const { secretary, admin, appointment } = await scene();

    const responses = await Promise.all([cancel(secretary.token, appointment.id), cancel(admin.token, appointment.id)]);

    expect(responses.map((r) => r.status).every((s) => s === 200 || s === 409)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'cancel' } })).toBe(1);
  });

  it('leaves no record when the appointment does not exist', async () => {
    const { secretary } = await scene();

    const res = await cancel(secretary.token, '00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
    expect(await entries()).toEqual([]);
  });
});

describe('patients handled by staff', () => {
  const createPatientAs = (token, body) => request(app).post('/api/patients').set(bearer(token)).send(body);
  const editPatient = (token, id, body) => request(app).put(`/api/patients/${id}`).set(bearer(token)).send(body);
  const NEW_PATIENT = { name: 'Zulema Quispe', phone: '+593991234567', email: 'zulema@example.test', cedula: '1712345678' };

  it('records a new patient with no data of the patient at all', async () => {
    const secretary = await createUser({ role: 'secretary', name: 'Ana Secretaria' });

    const res = await createPatientAs(secretary.token, NEW_PATIENT);

    expect(res.status).toBe(201);
    expect(await entries()).toEqual([
      expect.objectContaining({ actorId: secretary.user.id, action: 'create', entity: 'patient', entityId: res.body.id, doctorId: null, changes: null })
    ]);
    expect(await dump()).not.toMatch(/Zulema|zulema@|\+593991234567|1712345678/);
  });

  it('records re-sending an existing patient as an update that lists only the field names, and nothing if nothing differs', async () => {
    const secretary = await createUser({ role: 'secretary' });
    await createPatientAs(secretary.token, NEW_PATIENT);

    await createPatientAs(secretary.token, NEW_PATIENT);
    await createPatientAs(secretary.token, { ...NEW_PATIENT, name: 'Zulema Quispe Andrade', email: 'otro@example.test' });

    const [, update] = await entries();
    expect(await prisma.auditLog.count()).toBe(2);
    expect(update).toMatchObject({ action: 'update', entity: 'patient', changes: { name: { changed: true }, email: { changed: true } } });
    expect(await dump()).not.toMatch(/Andrade|otro@example/);
  });

  it('records an edit with the names of the fields that changed, never their values', async () => {
    const { secretary, patient } = await scene();

    const res = await editPatient(secretary.token, patient.id, { email: 'nuevo@example.test', cedula: '0102030405', name: 'Zulema Quispe' });

    expect(res.status).toBe(200);
    expect(await entries()).toEqual([
      expect.objectContaining({
        action: 'update',
        entity: 'patient',
        entityId: patient.id,
        changes: { email: { changed: true }, cedula: { changed: true } }
      })
    ]);
    expect(await dump()).not.toMatch(/nuevo@example|0102030405|1712345678|zulema@example/);
  });

  it('leaves no record when an edit changes nothing, fails validation or finds no patient', async () => {
    const { secretary, patient } = await scene();

    const same = await editPatient(secretary.token, patient.id, { name: 'Zulema Quispe' });
    const invalid = await editPatient(secretary.token, patient.id, { email: 'not-an-email' });
    const unknown = await editPatient(secretary.token, '00000000-0000-4000-8000-000000000000', { name: 'Nadie' });

    expect([same.status, invalid.status, unknown.status]).toEqual([200, 400, 404]);
    expect(await entries()).toEqual([]);
  });

  it('records a deletion by id only', async () => {
    const secretary = await createUser({ role: 'secretary' });
    const patient = await createPatient({ name: 'Por Error', phone: '+593990009999' });

    const res = await request(app).delete(`/api/patients/${patient.id}`).set(bearer(secretary.token));

    expect(res.status).toBe(200);
    expect(await entries()).toEqual([
      expect.objectContaining({ actorId: secretary.user.id, action: 'delete', entity: 'patient', entityId: patient.id, changes: null })
    ]);
    expect(await dump()).not.toMatch(/Por Error|990009999/);
  });

  it('leaves no record when the deletion is refused', async () => {
    const { secretary, patient } = await scene();

    const res = await request(app).delete(`/api/patients/${patient.id}`).set(bearer(secretary.token));

    expect(res.status).toBe(409);
    expect(await entries()).toEqual([]);
  });
});

describe('a booking by staff also records the patient it creates or changes', () => {
  it('leaves one entry for the patient and one for the appointment, and never the patient\'s data', async () => {
    const doctor = await createUser();
    const secretary = await createUser({ role: 'secretary' });

    await book(secretary.token, bookingBody({ doctorId: doctor.user.id }));

    expect((await entries()).map((e) => [e.entity, e.action])).toEqual([['patient', 'create'], ['appointment', 'create']]);
    expect(await dump()).not.toMatch(/Zulema|zulema@|\+593991234567|1712345678/);
  });

  it('records the patient as updated only when the booking changed something about them', async () => {
    const { doctor, secretary } = await scene();

    await book(secretary.token, bookingBody({ doctorId: doctor.user.id, time: '15:00' }));
    await book(secretary.token, bookingBody({ doctorId: doctor.user.id, time: '15:30', patientName: 'Zulema Quispe Andrade' }));

    expect((await entries()).map((e) => [e.entity, e.action, e.changes && Object.keys(e.changes).join()])).toEqual([
      ['appointment', 'create', 'date,time,status'],
      ['patient', 'update', 'name'],
      ['appointment', 'create', 'date,time,status']
    ]);
  });
});

describe('accounts managed by an admin', () => {
  const adminCreate = (token, body) => request(app).post('/api/admin/doctors').set(bearer(token)).send(body);
  const adminUpdate = (token, id, body) => request(app).put(`/api/admin/doctors/${id}`).set(bearer(token)).send(body);
  const adminDelete = (token, id) => request(app).delete(`/api/admin/doctors/${id}`).set(bearer(token));

  it('records a new account with its name and role, but not its email or password', async () => {
    const admin = await createUser({ role: 'admin', name: 'Admin Principal' });

    const res = await adminCreate(admin.token, { name: 'Marta Secretaria', email: 'marta@example.test', password: 'una-clave-larga', role: 'secretary' });

    expect(res.status).toBe(201);
    expect(await entries()).toEqual([
      expect.objectContaining({
        actorId: admin.user.id,
        actorName: 'Admin Principal',
        actorRole: 'admin',
        action: 'create',
        entity: 'user',
        entityId: res.body.id,
        changes: { name: { to: 'Marta Secretaria' }, role: { to: 'secretary' } }
      })
    ]);
    expect(await dump()).not.toMatch(/marta@example|una-clave-larga|\$2[aby]\$/);
  });

  it('records a role change with before and after, a rename with before and after, and an email change without the email', async () => {
    const admin = await createUser({ role: 'admin' });
    const { user } = await createUser({ name: 'Nombre Viejo', email: 'viejo@example.test' });

    await adminUpdate(admin.token, user.id, { role: 'secretary' });
    await adminUpdate(admin.token, user.id, { name: 'Nombre Nuevo' });
    await adminUpdate(admin.token, user.id, { email: 'nuevo@example.test' });

    expect((await entries()).map((e) => e.changes)).toEqual([
      { role: { from: 'doctor', to: 'secretary' } },
      { name: { from: 'Nombre Viejo', to: 'Nombre Nuevo' } },
      { email: { changed: true } }
    ]);
    expect(await dump()).not.toMatch(/viejo@example|nuevo@example/);
  });

  it('records a password change without anything of the password', async () => {
    const admin = await createUser({ role: 'admin' });
    const { user } = await createUser();

    await adminUpdate(admin.token, user.id, { password: 'nueva-clave-secreta' });

    expect((await entries())[0].changes).toEqual({ password: { changed: true } });
    expect(await dump()).not.toMatch(/nueva-clave-secreta|\$2[aby]\$/);
  });

  it('leaves no record when an edit changes nothing or finds no account', async () => {
    const admin = await createUser({ role: 'admin' });
    const { user } = await createUser({ name: 'Igual' });

    const same = await adminUpdate(admin.token, user.id, { name: 'Igual' });
    const unknown = await adminUpdate(admin.token, '00000000-0000-4000-8000-000000000000', { name: 'Nadie' });

    expect([same.status, unknown.status]).toEqual([200, 404]);
    expect(await entries()).toEqual([]);
  });

  it('records a deletion with the name and role, which are all that is left of the account afterwards', async () => {
    const admin = await createUser({ role: 'admin' });
    const { user } = await createUser({ name: 'Dr. Que Se Va' });

    const res = await adminDelete(admin.token, user.id);

    expect(res.status).toBe(200);
    expect(await entries()).toEqual([
      expect.objectContaining({ action: 'delete', entity: 'user', entityId: user.id, changes: { name: { from: 'Dr. Que Se Va' }, role: { from: 'doctor' } } })
    ]);
  });

  it('leaves no record when the deletion is refused', async () => {
    const { admin, doctor } = await scene();

    const res = await adminDelete(admin.token, doctor.user.id);

    expect(res.status).toBe(400);
    expect(await entries()).toEqual([]);
  });
});

describe('the record and the action are one: either both happen or neither does', () => {
  const HIDE = 'ALTER TABLE "AuditLog" RENAME TO "AuditLog_hidden"';
  const SHOW = 'ALTER TABLE "AuditLog_hidden" RENAME TO "AuditLog"';
  async function withoutAuditTable(run) {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await prisma.$executeRawUnsafe(HIDE);
    try {
      await run();
    } finally {
      await prisma.$executeRawUnsafe(SHOW);
    }
  }

  it('does not book the appointment, nor create its patient, when the record cannot be written', async () => {
    const doctor = await createUser();
    const secretary = await createUser({ role: 'secretary' });

    await withoutAuditTable(async () => {
      const res = await book(secretary.token, bookingBody({ doctorId: doctor.user.id }));
      expect(res.status).toBe(500);
    });

    expect(await prisma.appointment.count()).toBe(0);
    expect(await prisma.patient.count()).toBe(0);
  });

  it('does not cancel, edit or delete when the record cannot be written', async () => {
    const { secretary, admin, appointment, doctor } = await scene();
    const lonePatient = await createPatient({ phone: '+593990004444' });

    await withoutAuditTable(async () => {
      expect((await cancel(secretary.token, appointment.id)).status).toBe(500);
      expect((await reschedule(secretary.token, appointment.id, { time: '12:00' })).status).toBe(500);
      expect((await request(app).delete(`/api/patients/${lonePatient.id}`).set(bearer(secretary.token))).status).toBe(500);
      expect((await request(app).put(`/api/admin/doctors/${doctor.user.id}`).set(bearer(admin.token)).send({ name: 'Otro' })).status).toBe(500);
    });

    expect(await prisma.appointment.findUnique({ where: { id: appointment.id } })).toMatchObject({ status: 'pending_approval', time: '10:00' });
    expect(await prisma.patient.findUnique({ where: { id: lonePatient.id } })).not.toBeNull();
    expect((await prisma.doctor.findUnique({ where: { id: doctor.user.id } })).name).toBe(doctor.user.name);
  });

  it('does not stop a doctor, who is not recorded anyway, from working', async () => {
    const { doctor, appointment } = await scene();

    await withoutAuditTable(async () => {
      expect((await reschedule(doctor.token, appointment.id, { time: '11:00' })).status).toBe(200);
    });
  });
});

describe('GET /api/admin/audit-log', () => {
  const read = (token, query = '') => request(app).get(`/api/admin/audit-log${query}`).set(bearer(token));

  // entries written straight to the table, so the tests control who/when/what
  // (in the shared test clinic, which is where the admins of these tests work)
  const seed = async (rows) => {
    const clinic = await defaultClinic();
    return prisma.auditLog.createMany({
      data: rows.map((row) => ({
        actorId: 'actor-1',
        actorName: 'Ana Secretaria',
        actorRole: 'secretary',
        action: 'update',
        entity: 'appointment',
        entityId: 'entity-1',
        clinicId: clinic.id,
        ...row
      }))
    });
  };

  describe('who can read it', () => {
    it('is for admins only', async () => {
      const admin = await createUser({ role: 'admin' });
      const secretary = await createUser({ role: 'secretary' });
      const doctor = await createUser();

      expect((await read(admin.token)).status).toBe(200);
      for (const other of [secretary, doctor]) {
        const res = await read(other.token);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Access denied. Admin rights required.');
      }
      expect((await request(app).get('/api/admin/audit-log')).status).toBe(401);
    });

    it('cannot be used to change or erase entries', async () => {
      const admin = await createUser({ role: 'admin' });
      await seed([{}]);

      for (const method of ['post', 'put', 'patch', 'delete']) {
        const res = await request(app)[method]('/api/admin/audit-log').set(bearer(admin.token)).send({});
        expect(res.status).toBe(404);
      }
      expect(await prisma.auditLog.count()).toBe(1);
    });
  });

  describe('what it returns', () => {
    it('lists the newest first, with who did it, the doctor affected (by name) and what changed', async () => {
      const { admin, secretary, doctor, appointment } = await scene();
      await reschedule(secretary.token, appointment.id, { time: '11:30' });
      await cancel(secretary.token, appointment.id);

      const res = await read(admin.token);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 50, totalPages: 1 });
      expect(res.body.entries).toEqual([
        {
          id: expect.any(String),
          createdAt: expect.any(String),
          actor: { id: secretary.user.id, name: 'Ana Secretaria', role: 'secretary' },
          action: 'cancel',
          entity: 'appointment',
          entityId: appointment.id,
          doctor: { id: doctor.user.id, name: 'Dra. Camila Torres' },
          changes: { status: { from: 'pending_approval', to: 'cancelled' } }
        },
        expect.objectContaining({ action: 'update', changes: { time: { from: '10:00', to: '11:30' } } })
      ]);
    });

    it('lists the entries of one action in the order they happened, the last one first', async () => {
      const doctor = await createUser();
      const secretary = await createUser({ role: 'secretary' });
      const admin = await createUser({ role: 'admin' });
      await book(secretary.token, bookingBody({ doctorId: doctor.user.id }));

      const res = await read(admin.token);

      // the booking wrote the patient first and the appointment second, in one transaction
      expect(res.body.entries.map((e) => [e.entity, e.action])).toEqual([['appointment', 'create'], ['patient', 'create']]);
      expect(res.body.entries[0].createdAt).toBe(res.body.entries[1].createdAt);
    });

    it('keeps the entries, with the name the actor had, after the actor or the doctor are gone', async () => {
      const admin = await createUser({ role: 'admin' });
      await seed([{ actorId: 'deleted-actor', actorName: 'Ex Secretaria', doctorId: 'deleted-doctor' }]);

      const res = await read(admin.token);

      expect(res.body.entries[0]).toMatchObject({
        actor: { id: 'deleted-actor', name: 'Ex Secretaria', role: 'secretary' },
        doctor: { id: 'deleted-doctor', name: null }
      });
    });

    it('has no doctor on entries that are not about a doctor\'s agenda', async () => {
      const admin = await createUser({ role: 'admin' });
      await seed([{ entity: 'patient', doctorId: null }]);

      expect((await read(admin.token)).body.entries[0].doctor).toBeNull();
    });
  });

  describe('paging', () => {
    it('gives 50 per page by default and never more than 200', async () => {
      const admin = await createUser({ role: 'admin' });
      await seed(Array.from({ length: 205 }, (_, i) => ({ entityId: `e-${i}` })));

      const normal = await read(admin.token);
      const greedy = await read(admin.token, '?pageSize=1000');

      expect(normal.body).toMatchObject({ total: 205, pageSize: 50, totalPages: 5 });
      expect(normal.body.entries).toHaveLength(50);
      expect(greedy.body.pageSize).toBe(200);
      expect(greedy.body.entries).toHaveLength(200);
    });

    it('never repeats or skips an entry between pages, even when they share a timestamp', async () => {
      const admin = await createUser({ role: 'admin' });
      const sameMoment = new Date('2030-01-15T15:00:00.000Z');
      await seed(Array.from({ length: 7 }, (_, i) => ({ entityId: `e-${i}`, createdAt: sameMoment })));

      const seen = [];
      for (let page = 1; page <= 3; page++) {
        const res = await read(admin.token, `?pageSize=3&page=${page}`);
        seen.push(...res.body.entries.map((e) => e.id));
      }

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    });

    it.each([['pageSize=0'], ['page=0'], ['page=abc']])('rejects ?%s', async (query) => {
      const admin = await createUser({ role: 'admin' });

      expect((await read(admin.token, `?${query}`)).status).toBe(400);
    });
  });

  describe('filters', () => {
    it('filters by who did it, the kind of record, the action, the record itself and the doctor, alone or together', async () => {
      const admin = await createUser({ role: 'admin' });
      await seed([
        { actorId: 'ana', entity: 'appointment', action: 'create', entityId: 'a-1', doctorId: 'dr-1' },
        { actorId: 'ana', entity: 'appointment', action: 'cancel', entityId: 'a-1', doctorId: 'dr-1' },
        { actorId: 'ana', entity: 'patient', action: 'update', entityId: 'p-1', doctorId: null },
        { actorId: 'luis', entity: 'appointment', action: 'update', entityId: 'a-2', doctorId: 'dr-2' },
        { actorId: 'luis', entity: 'user', action: 'delete', entityId: 'u-1', doctorId: null }
      ]);
      const count = async (query) => (await read(admin.token, query)).body.total;

      expect(await count('?actorId=ana')).toBe(3);
      expect(await count('?entity=appointment')).toBe(3);
      expect(await count('?action=cancel')).toBe(1);
      expect(await count('?entityId=a-1')).toBe(2);
      expect(await count('?doctorId=dr-2')).toBe(1);
      expect(await count('?actorId=ana&entity=appointment')).toBe(2);
      expect(await count('?actorId=luis&entity=appointment&action=update&doctorId=dr-2&entityId=a-2')).toBe(1);
      expect(await count('?actorId=nobody')).toBe(0);
    });

    it('filters by date using clinic-local days, both ends included', async () => {
      const admin = await createUser({ role: 'admin' });
      // The clinic is UTC-5: its 10 March runs from 05:00 UTC to 04:59:59 UTC of the 11th
      await seed([
        { entityId: 'before', createdAt: new Date('2030-03-10T04:59:59.999Z') },
        { entityId: 'first-instant', createdAt: new Date('2030-03-10T05:00:00.000Z') },
        { entityId: 'afternoon', createdAt: new Date('2030-03-10T20:00:00.000Z') },
        { entityId: 'last-instant', createdAt: new Date('2030-03-11T04:59:59.999Z') },
        { entityId: 'after', createdAt: new Date('2030-03-11T05:00:00.000Z') }
      ]);
      const ids = async (query) => (await read(admin.token, query)).body.entries.map((e) => e.entityId).sort();

      expect(await ids('?from=2030-03-10&to=2030-03-10')).toEqual(['afternoon', 'first-instant', 'last-instant']);
      expect(await ids('?from=2030-03-10')).toEqual(['after', 'afternoon', 'first-instant', 'last-instant']);
      expect(await ids('?to=2030-03-10')).toEqual(['afternoon', 'before', 'first-instant', 'last-instant']);
      expect(await ids('?from=2030-03-09&to=2030-03-12')).toHaveLength(5);
    });

    it.each([
      ['a from that is not a date', '?from=10-03-2030', /from must be a valid date/],
      ['a to that does not exist', '?to=2030-02-31', /to must be a valid date/],
      ['a from after the to', '?from=2030-03-11&to=2030-03-10', /from must not be after to/],
      ['an unknown entity', '?entity=invoice', /entity must be one of: appointment, patient, user/],
      ['an unknown action', '?action=archive', /action must be one of: create, update, cancel, delete/],
      ['an empty actorId', '?actorId=', /actorId must be a non-empty text/],
      ['an actorId given twice', '?actorId=a&actorId=b', /actorId must be a non-empty text/],
      ['an enormous doctorId', `?doctorId=${'x'.repeat(65)}`, /doctorId must be a non-empty text/]
    ])('rejects %s', async (_label, query, message) => {
      const admin = await createUser({ role: 'admin' });

      const res = await read(admin.token, query);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    });
  });
});

describe('the helpers that decide what is kept', () => {
  it('diffFields keeps before and after of shown fields, only says that hidden ones changed, and ignores what did not change', () => {
    const before = { date: '2030-01-15', time: '10:00', status: 'confirmed', notes: null, ignored: 1 };
    const after = { date: '2030-01-16', time: '10:00', status: 'confirmed', notes: 'texto privado', ignored: 2 };

    expect(diffFields('appointment', before, after)).toEqual({
      date: { from: '2030-01-15', to: '2030-01-16' },
      notes: { changed: true }
    });
    expect(diffFields('appointment', before, before)).toBeNull();
  });

  it('describes what a record had when it was created or removed, using only its shown fields', () => {
    const user = { name: 'Marta', role: 'secretary', email: 'marta@example.test', password: 'hash' };

    expect(describeCreated('user', user)).toEqual({ name: { to: 'Marta' }, role: { to: 'secretary' } });
    expect(describeRemoved('user', user)).toEqual({ name: { from: 'Marta' }, role: { from: 'secretary' } });
    expect(describeCreated('patient', { name: 'x', phone: 'y' })).toBeNull();
  });
});
