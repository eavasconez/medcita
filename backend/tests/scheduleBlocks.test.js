const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');
const { easter } = require('../src/services/ecuadorHolidays');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});
afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

const list = (token, query = '') => request(app).get(`/api/schedule-blocks${query}`).set(bearer(token));
const create = (token, body) => request(app).post('/api/schedule-blocks').set(bearer(token)).send(body);
const remove = (token, id) => request(app).delete(`/api/schedule-blocks/${id}`).set(bearer(token));
const book = (token, body) =>
  request(app).post('/api/appointments').set(bearer(token)).send({ patientName: 'Ana Paciente', patientPhone: '+593990000001', time: '09:00', ...body });
const slots = (token, date, doctorId) => request(app).get('/api/availability/slots').query({ date, ...(doctorId && { doctorId }) }).set(bearer(token));

// 2030-02-04 is a Monday: a week of days nobody has booked anything on
const FEB = (day) => `2030-02-${String(day).padStart(2, '0')}`;

// An admin, a secretary and two doctors of one clinic
async function clinicOf() {
  const admin = await createUser({ role: 'admin' });
  const clinic = { id: admin.user.clinicId };
  return {
    admin,
    clinic,
    secretary: await createUser({ role: 'secretary', clinic }),
    doctor: await createUser({ name: 'Dra. Uno', clinic }),
    other: await createUser({ name: 'Dr. Dos', clinic })
  };
}

describe('Ecuador holidays', () => {
  const holidays = (token, query = '') => request(app).get(`/api/schedule-blocks/holidays${query}`).set(bearer(token));
  const dates = (res) => Object.fromEntries(res.body.holidays.map((h) => [h.name, h.date]));

  it('computes Easter right for years with known dates', () => {
    expect(easter(2024)).toEqual([3, 31]);
    expect(easter(2025)).toEqual([4, 20]);
    expect(easter(2026)).toEqual([4, 5]);
    expect(easter(2027)).toEqual([3, 28]);
  });

  it('lists the national holidays of a year, the movable ones counted from Easter', async () => {
    const { admin } = await clinicOf();

    const res = await holidays(admin.token, '?year=2026');

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(dates(res)).toEqual({
      'Año Nuevo': '2026-01-01',
      'Carnaval (lunes)': '2026-02-16',
      'Carnaval (martes)': '2026-02-17',
      'Viernes Santo': '2026-04-03',
      'Día del Trabajo': '2026-05-01',
      'Batalla de Pichincha': '2026-05-24',
      'Primer Grito de Independencia': '2026-08-10',
      'Independencia de Guayaquil': '2026-10-09',
      'Día de Difuntos': '2026-11-02',
      'Independencia de Cuenca': '2026-11-03',
      Navidad: '2026-12-25'
    });
    expect(res.body.holidays.map((h) => h.date)).toEqual([...res.body.holidays.map((h) => h.date)].sort());
  });

  it('warns that the fixed ones may be moved by the Ministry, and not the ones that never are', async () => {
    const { admin } = await clinicOf();

    const res = await holidays(admin.token, '?year=2027');
    const byName = Object.fromEntries(res.body.holidays.map((h) => [h.name, h]));

    expect(dates(res)['Viernes Santo']).toBe('2027-03-26');
    expect(byName['Viernes Santo'].note).toBeNull();
    expect(byName.Navidad.note).toMatch(/Ministerio del Trabajo/);
  });

  it('uses the current year by default and rejects a year that makes no sense', async () => {
    const { admin } = await clinicOf();

    expect((await holidays(admin.token)).body.year).toBe(new Date().getUTCFullYear());
    for (const year of ['abc', '1999', '2101', '2026.5']) expect((await holidays(admin.token, `?year=${year}`)).status).toBe(400);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/schedule-blocks/holidays')).status).toBe(401);
  });
});

describe('POST /api/schedule-blocks', () => {
  it('blocks a range for one doctor, and the answer lists what was already booked there', async () => {
    const { admin, doctor, other } = await clinicOf();
    const patient = await createPatient({ clinic: { id: admin.user.clinicId } });
    const inside = await createAppointment({ doctor: doctor.user, patient, date: FEB(5), time: '10:00', status: 'confirmed' });
    await createAppointment({ doctor: doctor.user, patient, date: FEB(6), time: '10:00', status: 'cancelled' });
    await createAppointment({ doctor: doctor.user, patient, date: FEB(11), time: '10:00' }); // after the block
    await createAppointment({ doctor: other.user, patient, date: FEB(5), time: '10:00' }); // another doctor

    const res = await create(admin.token, { startDate: FEB(4), endDate: FEB(8), reason: 'Vacaciones', doctorId: doctor.user.id });

    expect(res.status).toBe(201);
    expect(res.body.block).toEqual({
      id: expect.any(String),
      scope: 'doctor',
      doctorId: doctor.user.id,
      doctorName: 'Dra. Uno',
      startDate: FEB(4),
      endDate: FEB(8),
      reason: 'Vacaciones',
      createdAt: expect.any(String)
    });
    expect(res.body.affectedTotal).toBe(1);
    expect(res.body.affectedAppointments).toEqual([
      { id: inside.id, date: FEB(5), time: '10:00', status: 'confirmed', patient: { id: patient.id, name: patient.name, phone: patient.phone }, doctor: { id: doctor.user.id, name: 'Dra. Uno' } }
    ]);
    // nothing is cancelled for them
    expect((await prisma.appointment.findUnique({ where: { id: inside.id } })).status).toBe('confirmed');
  });

  it('blocks a single day when only startDate is given, and tidies the reason', async () => {
    const { secretary, doctor } = await clinicOf();

    const res = await create(secretary.token, { startDate: FEB(5), reason: '  Congreso   médico ', doctorId: doctor.user.id });

    expect(res.status).toBe(201);
    expect(res.body.block).toMatchObject({ startDate: FEB(5), endDate: FEB(5), reason: 'Congreso médico' });
  });

  it('blocks the whole clinic and lists the appointments of every doctor', async () => {
    const { admin, doctor, other } = await clinicOf();
    const patient = await createPatient({ clinic: { id: admin.user.clinicId } });
    await createAppointment({ doctor: doctor.user, patient, date: FEB(5), time: '09:00' });
    await createAppointment({ doctor: other.user, patient, date: FEB(5), time: '09:00' });

    const res = await create(admin.token, { scope: 'clinic', startDate: FEB(5), reason: 'Feriado' });

    expect(res.status).toBe(201);
    expect(res.body.block).toMatchObject({ scope: 'clinic', doctorId: null, doctorName: null });
    expect(res.body.affectedTotal).toBe(2);
  });

  it('lets a doctor block their own agenda, with or without saying who', async () => {
    const { doctor } = await clinicOf();

    const implicit = await create(doctor.token, { startDate: FEB(5), reason: 'Cirugía' });
    const explicit = await create(doctor.token, { startDate: FEB(6), reason: 'Cirugía', doctorId: doctor.user.id });

    expect(implicit.body.block.doctorId).toBe(doctor.user.id);
    expect(explicit.status).toBe(201);
  });

  it('does not let a doctor block someone else\'s agenda or the whole clinic', async () => {
    const { doctor, other } = await clinicOf();

    expect((await create(doctor.token, { startDate: FEB(5), reason: 'Ajeno', doctorId: other.user.id })).status).toBe(403);
    expect((await create(doctor.token, { startDate: FEB(5), reason: 'Todos', scope: 'clinic' })).status).toBe(403);
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('needs the doctor when staff block one, and the doctor must be of the clinic', async () => {
    const { admin } = await clinicOf();
    const stranger = await createUser({ clinic: await createClinic() });

    expect((await create(admin.token, { startDate: FEB(5), reason: 'Falta el médico' })).status).toBe(400);
    expect((await create(admin.token, { startDate: FEB(5), reason: 'De otro consultorio', doctorId: stranger.user.id })).status).toBe(404);
    expect((await create(admin.token, { startDate: FEB(5), reason: 'Inventado', doctorId: '00000000-0000-4000-8000-0000000000aa' })).status).toBe(404);
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it.each([
    ['no start date', { reason: 'Motivo' }, /startDate must be a valid date/],
    ['an invalid start date', { startDate: '2030-02-30', reason: 'Motivo' }, /startDate must be a valid date/],
    ['an invalid end date', { startDate: FEB(5), endDate: 'mañana', reason: 'Motivo' }, /endDate must be a valid date/],
    ['an end before the start', { startDate: FEB(6), endDate: FEB(5), reason: 'Motivo' }, /startDate must not be after endDate/],
    ['a range longer than a year', { startDate: '2030-01-01', endDate: '2031-01-02', reason: 'Motivo' }, /at most 366 days/],
    ['no reason', { startDate: FEB(5) }, /reason must be between 2 and 120/],
    ['a blank reason', { startDate: FEB(5), reason: '   ' }, /reason must be between 2 and 120/],
    ['a reason that is too long', { startDate: FEB(5), reason: 'x'.repeat(121) }, /reason must be between 2 and 120/],
    ['an unknown scope', { startDate: FEB(5), reason: 'Motivo', scope: 'todos' }, /scope must be/],
    ['a block that ends in the past', { startDate: '2020-01-01', endDate: '2020-01-05', reason: 'Motivo' }, /cannot end in the past/]
  ])('rejects %s', async (_label, body, message) => {
    const { admin, doctor } = await clinicOf();

    const res = await create(admin.token, { doctorId: doctor.user.id, ...body });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('accepts a range of exactly one year', async () => {
    const { admin, doctor } = await clinicOf();

    expect((await create(admin.token, { startDate: '2030-01-01', endDate: '2030-12-31', reason: 'Año sabático', doctorId: doctor.user.id })).status).toBe(201);
  });

  it('stops at 500 blocks per clinic', async () => {
    const { admin } = await clinicOf();
    await prisma.scheduleBlock.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ clinicId: admin.user.clinicId, startDate: '2030-03-01', endDate: '2030-03-01', reason: `Motivo ${i}` }))
    });

    const res = await create(admin.token, { scope: 'clinic', startDate: FEB(5), reason: 'Uno más' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 500 blocks/);
  });

  it('records who blocked what in the audit log, without the reason', async () => {
    const { admin, doctor } = await clinicOf();

    const res = await create(admin.token, { startDate: FEB(5), endDate: FEB(7), reason: 'Operación de rodilla', doctorId: doctor.user.id });

    const entry = await prisma.auditLog.findFirst({ where: { entity: 'schedule_block', entityId: res.body.block.id } });
    expect(entry).toMatchObject({ action: 'create', actorId: admin.user.id, doctorId: doctor.user.id, clinicId: admin.user.clinicId });
    expect(entry.changes).toEqual({ startDate: { to: FEB(5) }, endDate: { to: FEB(7) } });
    expect(JSON.stringify(entry)).not.toMatch(/rodilla/);
  });

  it('requires authentication', async () => {
    expect((await request(app).post('/api/schedule-blocks').send({ startDate: FEB(5), reason: 'Motivo' })).status).toBe(401);
  });
});

describe('what a block does to booking', () => {
  it('refuses to book on a blocked day, on the first day, the last day and every day between', async () => {
    const { admin, doctor } = await clinicOf();
    await create(admin.token, { startDate: FEB(5), endDate: FEB(7), reason: 'Vacaciones', doctorId: doctor.user.id });

    for (const day of [5, 6, 7]) {
      const res = await book(doctor.token, { date: FEB(day) });
      expect([day, res.status, res.body.error]).toEqual([day, 400, 'The doctor does not attend on this date']);
    }
    expect((await book(doctor.token, { date: FEB(4) })).status).toBe(201); // the day before
    expect((await book(doctor.token, { date: FEB(8), patientPhone: '+593990000002' })).status).toBe(201); // the day after
    expect(await prisma.appointment.count({ where: { date: { in: [FEB(5), FEB(6), FEB(7)] } } })).toBe(0);
  });

  it('closes only that doctor\'s agenda; the others keep working', async () => {
    const { admin, doctor, other } = await clinicOf();
    await create(admin.token, { startDate: FEB(5), reason: 'Vacaciones', doctorId: doctor.user.id });

    expect((await book(doctor.token, { date: FEB(5) })).status).toBe(400);
    expect((await book(other.token, { date: FEB(5) })).status).toBe(201);
    // staff booking for the blocked doctor is refused too
    expect((await book(admin.token, { date: FEB(5), doctorId: doctor.user.id, patientPhone: '+593990000002' })).status).toBe(400);
  });

  it('closes every doctor of the clinic with a clinic-wide block, but no other clinic', async () => {
    const { admin, doctor, other } = await clinicOf();
    const elsewhere = await createUser({ clinic: await createClinic() });
    await create(admin.token, { scope: 'clinic', startDate: FEB(5), reason: 'Feriado' });

    expect((await book(doctor.token, { date: FEB(5) })).status).toBe(400);
    expect((await book(other.token, { date: FEB(5) })).status).toBe(400);
    expect((await book(elsewhere.token, { date: FEB(5) })).status).toBe(201);
  });

  it('refuses to move an appointment onto a blocked day, and to bring a cancelled one back to it', async () => {
    const { admin, doctor } = await clinicOf();
    const patient = await createPatient({ clinic: { id: admin.user.clinicId } });
    const moving = await createAppointment({ doctor: doctor.user, patient, date: FEB(4), time: '09:00' });
    const cancelled = await createAppointment({ doctor: doctor.user, patient, date: FEB(5), time: '11:00', status: 'cancelled' });
    await create(admin.token, { startDate: FEB(5), reason: 'Vacaciones', doctorId: doctor.user.id });

    const move = await request(app).put(`/api/appointments/${moving.id}`).set(bearer(doctor.token)).send({ date: FEB(5) });
    const reactivate = await request(app).put(`/api/appointments/${cancelled.id}`).set(bearer(doctor.token)).send({ status: 'scheduled' });

    expect(move.status).toBe(400);
    expect(move.body.error).toBe('The doctor does not attend on this date');
    expect(reactivate.status).toBe(400);
    expect((await prisma.appointment.findUnique({ where: { id: moving.id } })).date).toBe(FEB(4));
  });

  it('lets an appointment that was already on the blocked day change status and type, and be moved out', async () => {
    const { admin, doctor } = await clinicOf();
    const patient = await createPatient({ clinic: { id: admin.user.clinicId } });
    const apt = await createAppointment({ doctor: doctor.user, patient, date: FEB(5), time: '09:00', status: 'scheduled' });
    const check = (await request(app).post('/api/appointment-types').set(bearer(admin.token)).send({ name: 'Control', durationMinutes: 20 })).body;
    await create(admin.token, { startDate: FEB(5), reason: 'Vacaciones', doctorId: doctor.user.id });
    const put = (body) => request(app).put(`/api/appointments/${apt.id}`).set(bearer(doctor.token)).send(body);

    expect((await put({ status: 'confirmed' })).status).toBe(200);
    expect((await put({ typeId: check.id })).status).toBe(200);
    expect((await put({ date: FEB(6) })).status).toBe(200); // rescheduled to a free day
  });

  it('offers no slots on a blocked day, and the others as usual', async () => {
    const { admin, doctor, other } = await clinicOf();
    await create(admin.token, { startDate: FEB(5), reason: 'Vacaciones', doctorId: doctor.user.id });

    expect((await slots(doctor.token, FEB(5))).body).toEqual([]);
    expect((await slots(doctor.token, FEB(6))).body.length).toBeGreaterThan(0);
    expect((await slots(other.token, FEB(5))).body.length).toBeGreaterThan(0);
    expect((await slots(admin.token, FEB(5), doctor.user.id)).body).toEqual([]);
  });

  it('opens the days again when the block is removed', async () => {
    const { admin, doctor } = await clinicOf();
    const block = (await create(admin.token, { startDate: FEB(5), reason: 'Vacaciones', doctorId: doctor.user.id })).body.block;
    expect((await book(doctor.token, { date: FEB(5) })).status).toBe(400);

    await remove(admin.token, block.id);

    expect((await book(doctor.token, { date: FEB(5) })).status).toBe(201);
  });

  it('overlapping blocks simply add up: removing one leaves the other\'s days closed', async () => {
    const { admin, doctor } = await clinicOf();
    const first = (await create(admin.token, { scope: 'clinic', startDate: FEB(5), endDate: FEB(6), reason: 'Feriado' })).body.block;
    await create(admin.token, { startDate: FEB(6), endDate: FEB(7), reason: 'Vacaciones', doctorId: doctor.user.id });

    await remove(admin.token, first.id);

    expect((await book(doctor.token, { date: FEB(5) })).status).toBe(201);
    expect((await book(doctor.token, { date: FEB(6), patientPhone: '+593990000002' })).status).toBe(400);
  });
});

describe('GET /api/schedule-blocks', () => {
  it('lists the blocks that touch a range, by date, with whose agenda they close', async () => {
    const { admin, doctor } = await clinicOf();
    await create(admin.token, { startDate: FEB(12), reason: 'Más tarde', doctorId: doctor.user.id });
    await create(admin.token, { scope: 'clinic', startDate: FEB(4), endDate: FEB(6), reason: 'Feriado' });
    await create(admin.token, { startDate: FEB(6), endDate: FEB(9), reason: 'Vacaciones', doctorId: doctor.user.id });

    const all = await list(admin.token);
    const week = await list(admin.token, `?from=${FEB(7)}&to=${FEB(8)}`);

    expect(all.body.map((b) => [b.reason, b.scope, b.startDate])).toEqual([
      ['Feriado', 'clinic', FEB(4)],
      ['Vacaciones', 'doctor', FEB(6)],
      ['Más tarde', 'doctor', FEB(12)]
    ]);
    expect(week.body.map((b) => b.reason)).toEqual(['Vacaciones']); // overlaps the range without being inside it
  });

  it('shows a doctor their own blocks and the clinic\'s, never another doctor\'s', async () => {
    const { admin, doctor, other } = await clinicOf();
    await create(admin.token, { startDate: FEB(5), reason: 'Mío', doctorId: doctor.user.id });
    await create(admin.token, { startDate: FEB(5), reason: 'Del otro', doctorId: other.user.id });
    await create(admin.token, { scope: 'clinic', startDate: FEB(5), reason: 'De todos' });

    expect((await list(doctor.token)).body.map((b) => b.reason).sort()).toEqual(['De todos', 'Mío']);
    expect((await list(admin.token)).body).toHaveLength(3);
  });

  it('lets staff look at what touches one doctor', async () => {
    const { admin, secretary, doctor, other } = await clinicOf();
    await create(admin.token, { startDate: FEB(5), reason: 'Mío', doctorId: doctor.user.id });
    await create(admin.token, { startDate: FEB(5), reason: 'Del otro', doctorId: other.user.id });
    await create(admin.token, { scope: 'clinic', startDate: FEB(5), reason: 'De todos' });

    const res = await list(secretary.token, `?doctorId=${doctor.user.id}`);

    expect(res.body.map((b) => b.reason).sort()).toEqual(['De todos', 'Mío']);
  });

  it('never shows the blocks of another clinic', async () => {
    const { admin } = await clinicOf();
    const outsider = await createUser({ role: 'admin', clinic: await createClinic() });
    await create(outsider.token, { scope: 'clinic', startDate: FEB(5), reason: 'Ajeno' });

    expect((await list(admin.token)).body).toEqual([]);
    expect((await list(outsider.token)).body).toHaveLength(1);
  });

  it.each([
    ['a bad from', '?from=ayer', /from must be a valid date/],
    ['a bad to', '?to=2030-13-01', /to must be a valid date/],
    ['a from after the to', `?from=${FEB(8)}&to=${FEB(5)}`, /from must not be after to/]
  ])('rejects %s', async (_label, query, message) => {
    const { admin } = await clinicOf();

    const res = await list(admin.token, query);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/schedule-blocks')).status).toBe(401);
  });
});

describe('GET /api/schedule-blocks/:id/appointments', () => {
  it('lists what is still booked inside the block, without the cancelled ones, a doctor only theirs', async () => {
    const { admin, doctor, other } = await clinicOf();
    const patient = await createPatient({ clinic: { id: admin.user.clinicId } });
    const mine = await createAppointment({ doctor: doctor.user, patient, date: FEB(5), time: '09:00' });
    const theirs = await createAppointment({ doctor: other.user, patient, date: FEB(5), time: '10:00' });
    await createAppointment({ doctor: doctor.user, patient, date: FEB(5), time: '11:00', status: 'cancelled' });
    const block = (await create(admin.token, { scope: 'clinic', startDate: FEB(5), reason: 'Feriado' })).body.block;

    const staff = await request(app).get(`/api/schedule-blocks/${block.id}/appointments`).set(bearer(admin.token));
    const own = await request(app).get(`/api/schedule-blocks/${block.id}/appointments`).set(bearer(doctor.token));

    expect(staff.body.affectedAppointments.map((a) => a.id)).toEqual([mine.id, theirs.id]);
    expect(own.body.affectedAppointments.map((a) => a.id)).toEqual([mine.id]);
    expect(own.body.affectedTotal).toBe(1);
  });

  it('goes down as the appointments are moved or cancelled', async () => {
    const { admin, doctor } = await clinicOf();
    const patient = await createPatient({ clinic: { id: admin.user.clinicId } });
    const apt = await createAppointment({ doctor: doctor.user, patient, date: FEB(5), time: '09:00' });
    const block = (await create(admin.token, { startDate: FEB(5), reason: 'Vacaciones', doctorId: doctor.user.id })).body.block;

    await request(app).put(`/api/appointments/${apt.id}`).set(bearer(admin.token)).send({ date: FEB(6) });

    const res = await request(app).get(`/api/schedule-blocks/${block.id}/appointments`).set(bearer(admin.token));
    expect(res.body.affectedTotal).toBe(0);
  });

  it('answers 404 for a block of another clinic and for another doctor\'s block', async () => {
    const { admin, doctor, other } = await clinicOf();
    const outsider = await createUser({ role: 'admin', clinic: await createClinic() });
    const block = (await create(admin.token, { startDate: FEB(5), reason: 'Del otro', doctorId: other.user.id })).body.block;

    expect((await request(app).get(`/api/schedule-blocks/${block.id}/appointments`).set(bearer(outsider.token))).status).toBe(404);
    expect((await request(app).get(`/api/schedule-blocks/${block.id}/appointments`).set(bearer(doctor.token))).status).toBe(404);
  });
});

describe('DELETE /api/schedule-blocks/:id', () => {
  it('lets staff remove any block of the clinic, and says so in the audit log', async () => {
    const { admin, secretary, doctor } = await clinicOf();
    const block = (await create(admin.token, { startDate: FEB(5), endDate: FEB(6), reason: 'Vacaciones', doctorId: doctor.user.id })).body.block;

    const res = await remove(secretary.token, block.id);

    expect(res.status).toBe(200);
    expect(await prisma.scheduleBlock.count()).toBe(0);
    const entry = await prisma.auditLog.findFirst({ where: { entity: 'schedule_block', entityId: block.id, action: 'delete' } });
    expect(entry).toMatchObject({ actorId: secretary.user.id, doctorId: doctor.user.id });
    expect(entry.changes).toEqual({ startDate: { from: FEB(5) }, endDate: { from: FEB(6) } });
  });

  it('lets a doctor remove their own block, but not a clinic-wide one or another doctor\'s', async () => {
    const { admin, doctor, other } = await clinicOf();
    const mine = (await create(doctor.token, { startDate: FEB(5), reason: 'Mío' })).body.block;
    const everyone = (await create(admin.token, { scope: 'clinic', startDate: FEB(6), reason: 'Feriado' })).body.block;
    const theirs = (await create(admin.token, { startDate: FEB(7), reason: 'Del otro', doctorId: other.user.id })).body.block;

    expect((await remove(doctor.token, everyone.id)).status).toBe(403);
    expect((await remove(doctor.token, theirs.id)).status).toBe(404);
    expect((await remove(doctor.token, mine.id)).status).toBe(200);
    expect(await prisma.scheduleBlock.count()).toBe(2);
  });

  it('answers 404 for a block of another clinic or one that does not exist', async () => {
    const { admin } = await clinicOf();
    const outsider = await createUser({ role: 'admin', clinic: await createClinic() });
    const block = (await create(admin.token, { scope: 'clinic', startDate: FEB(5), reason: 'Feriado' })).body.block;

    expect((await remove(outsider.token, block.id)).status).toBe(404);
    expect((await remove(admin.token, '00000000-0000-4000-8000-0000000000aa')).status).toBe(404);
    expect(await prisma.scheduleBlock.count()).toBe(1);
    expect((await remove(admin.token, block.id)).status).toBe(200);
    expect((await remove(admin.token, block.id)).status).toBe(404);
  });
});

describe('a doctor who leaves', () => {
  it('takes their blocks with them, and not the clinic\'s', async () => {
    const { admin, doctor } = await clinicOf();
    await create(admin.token, { startDate: FEB(5), reason: 'Vacaciones', doctorId: doctor.user.id });
    await create(admin.token, { scope: 'clinic', startDate: FEB(6), reason: 'Feriado' });

    await prisma.doctor.delete({ where: { id: doctor.user.id } });

    expect((await prisma.scheduleBlock.findMany()).map((b) => b.reason)).toEqual(['Feriado']);
  });
});
