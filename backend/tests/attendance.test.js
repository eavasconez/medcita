const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { MONDAY, TUESDAY, clinicParts } = require('./helpers/time');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const get = (path, token, query = {}) => request(app).get(path).query(query).set(bearer(token));
const put = (token, id, body) => request(app).put(`/api/appointments/${id}`).set(bearer(token)).send(body);

// A date a few days back and its month, so tests do not depend on today's date
const past = (hours) => clinicParts(-hours);
const monthOf = (date) => date.slice(0, 7);

describe('closing a consultation: statuses', () => {
  it.each(['arrived', 'in_progress', 'completed'])('lets the doctor mark an appointment as %s', async (status) => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    const apt = await createAppointment({ doctor: user, patient, date: TUESDAY, time: '09:00', status: 'confirmed' });

    const res = await put(token, apt.id, { status });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(status);
  });

  it('marks a visit whose time has passed as no_show, and the audit log says who did it when staff do', async () => {
    const { user } = await createUser();
    const admin = await createUser({ role: 'admin', email: 'adm@x.test' });
    const patient = await createPatient();
    const apt = await createAppointment({ doctor: user, patient, ...past(3), status: 'confirmed' });

    const res = await put(admin.token, apt.id, { status: 'no_show' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_show');
    const entry = await prisma.auditLog.findFirst({ where: { entityId: apt.id, action: 'update' } });
    expect(entry.changes).toEqual({ status: { from: 'confirmed', to: 'no_show' } });
  });

  it('refuses no_show for a visit that has not happened yet', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    const apt = await createAppointment({ doctor: user, patient, date: TUESDAY, time: '09:00', status: 'confirmed' });

    const res = await put(token, apt.id, { status: 'no_show' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no-show before its time/);
    expect((await prisma.appointment.findUnique({ where: { id: apt.id } })).status).toBe('confirmed');
  });

  it('keeps no_show on an appointment that already has it even when other fields change', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    const apt = await createAppointment({ doctor: user, patient, ...past(3), status: 'no_show' });

    const res = await put(token, apt.id, { notes: 'Llamó después' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_show');
  });

  it('still holds the slot: nobody else can book over a visit marked arrived', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    await createAppointment({ doctor: user, patient, date: TUESDAY, time: '09:00', status: 'arrived' });

    const res = await request(app).post('/api/appointments').set(bearer(token)).send({
      patientName: 'Otra Persona', patientPhone: '+593990000099', date: TUESDAY, time: '09:00'
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/appointments/stats', () => {
  it('counts attended visits as positive and no-shows apart', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    await createAppointment({ doctor: user, patient, date: MONDAY, time: '09:00', status: 'arrived' });
    await createAppointment({ doctor: user, patient, date: MONDAY, time: '10:00', status: 'in_progress' });
    await createAppointment({ doctor: user, patient, date: MONDAY, time: '11:00', status: 'no_show' });

    const res = await get('/api/appointments/stats', token);

    expect(res.body).toEqual({ total: 3, positive: 2, cancelled: 0, noShow: 1, patients: 1 });
  });
});

describe('GET /api/appointments/unclosed', () => {
  it('lists only past appointments still open, oldest first', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    const old = await createAppointment({ doctor: user, patient, ...past(48), status: 'confirmed' });
    const recent = await createAppointment({ doctor: user, patient, ...past(2), status: 'scheduled' });
    await createAppointment({ doctor: user, patient, ...past(5), status: 'completed' });
    await createAppointment({ doctor: user, patient, ...past(6), status: 'no_show' });
    await createAppointment({ doctor: user, patient, ...past(7), status: 'cancelled' });
    await createAppointment({ doctor: user, patient, date: TUESDAY, time: '09:00', status: 'confirmed' });

    const res = await get('/api/appointments/unclosed', token);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.appointments.map((a) => a.id)).toEqual([old.id, recent.id]);
    expect(res.body.appointments[0].Patient.name).toBe(patient.name);
  });

  it('does not leave out an appointment from earlier today whose time has already passed', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    const apt = await createAppointment({ doctor: user, patient, ...past(0.5), status: 'pending_approval' });

    const res = await get('/api/appointments/unclosed', token);

    expect(res.body.appointments.map((a) => a.id)).toEqual([apt.id]);
  });

  it('shows a doctor only their own and never another clinic\'s', async () => {
    const clinic = await createClinic({ name: 'Otro' });
    const mine = await createUser({ email: 'a@x.test' });
    const colleague = await createUser({ email: 'b@x.test' });
    const stranger = await createUser({ clinic, email: 'c@x.test' });
    const patient = await createPatient();
    const foreignPatient = await createPatient({ clinic });
    const own = await createAppointment({ doctor: mine.user, patient, ...past(3), status: 'confirmed' });
    await createAppointment({ doctor: colleague.user, patient, ...past(4), status: 'confirmed' });
    await createAppointment({ doctor: stranger.user, patient: foreignPatient, ...past(5), status: 'confirmed' });

    const res = await get('/api/appointments/unclosed', mine.token);

    expect(res.body.appointments.map((a) => a.id)).toEqual([own.id]);
  });
});

describe('GET /api/appointments/attendance', () => {
  async function seedMonth() {
    const { user, token } = await createUser();
    const ana = await createPatient({ name: 'Ana Falta' });
    const luis = await createPatient({ name: 'Luis Viene' });
    const when = past(24 * 3);
    const month = monthOf(when.date);
    const at = (time) => ({ doctor: user, date: when.date, time });
    await createAppointment({ ...at('08:00'), patient: luis, status: 'completed' });
    await createAppointment({ ...at('08:30'), patient: luis, status: 'completed' });
    await createAppointment({ ...at('09:00'), patient: luis, status: 'arrived' });
    await createAppointment({ ...at('09:30'), patient: ana, status: 'no_show' });
    await createAppointment({ ...at('10:00'), patient: ana, status: 'confirmed' });
    await createAppointment({ ...at('10:30'), patient: ana, status: 'scheduled' });
    await createAppointment({ ...at('11:00'), patient: ana, status: 'pending_approval' });
    await createAppointment({ ...at('11:30'), patient: ana, status: 'cancelled' });
    return { user, token, month, date: when.date, ana };
  }

  it('gives the no-show rate of the closed visits and confirmed against not confirmed', async () => {
    const { token, month } = await seedMonth();

    const res = await get('/api/appointments/attendance', token, { month });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ month, attended: 3, noShow: 1, noShowRate: 25, confirmed: 1, notConfirmed: 2 });
  });

  it('lists the no-shows per patient, most first, with the patient name', async () => {
    const { token, user, month, ana } = await seedMonth();
    await createAppointment({ doctor: user, patient: ana, date: MONDAY, time: '09:00', status: 'no_show' });

    const res = await get('/api/appointments/attendance', token, { month });

    expect(res.body.noShowByPatient).toEqual([{ patientId: ana.id, name: 'Ana Falta', noShows: 2 }]);
  });

  it('has no rate when no visit has been closed yet, and ignores other months', async () => {
    const { token } = await seedMonth();

    const res = await get('/api/appointments/attendance', token, { month: '2020-01' });

    expect(res.body).toMatchObject({ month: '2020-01', attended: 0, noShow: 0, noShowRate: null, confirmed: 0, notConfirmed: 0 });
  });

  it('uses the current month by default', async () => {
    const { token, month } = await seedMonth();

    const res = await get('/api/appointments/attendance', token);

    expect(res.body.month).toBe(monthOf(clinicParts(0).date));
    expect([month, res.body.month]).toContain(res.body.month);
  });

  it.each(['2030-13', '2030-1', 'abril', '2030-01-01'])('rejects the month %s', async (month) => {
    const { token } = await createUser();

    const res = await get('/api/appointments/attendance', token, { month });

    expect(res.status).toBe(400);
  });

  it('counts only the caller\'s clinic and, for a doctor, only their own appointments', async () => {
    const clinic = await createClinic({ name: 'Otro' });
    const mine = await createUser({ email: 'a@x.test' });
    const colleague = await createUser({ email: 'b@x.test' });
    const stranger = await createUser({ clinic, email: 'c@x.test' });
    const patient = await createPatient();
    const foreignPatient = await createPatient({ clinic });
    const when = past(24);
    await createAppointment({ doctor: mine.user, patient, ...when, status: 'no_show' });
    await createAppointment({ doctor: colleague.user, patient, date: when.date, time: '07:00', status: 'no_show' });
    await createAppointment({ doctor: stranger.user, patient: foreignPatient, date: when.date, time: '07:00', status: 'no_show' });
    const admin = await createUser({ role: 'admin', email: 'adm@x.test' });

    const asDoctor = await get('/api/appointments/attendance', mine.token, { month: monthOf(when.date) });
    const asAdmin = await get('/api/appointments/attendance', admin.token, { month: monthOf(when.date) });

    expect(asDoctor.body.noShow).toBe(1);
    expect(asAdmin.body.noShow).toBe(2);
    expect(asAdmin.body.noShowByPatient).toHaveLength(1);
  });
});

describe('reminders skip the visits that already happened', () => {
  it.each(['arrived', 'in_progress', 'completed', 'no_show'])('never owes a reminder for %s', async (status) => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    const apt = await createAppointment({ doctor: user, patient, ...clinicParts(2), status });

    const res = await get(`/api/appointments/${apt.id}/notifications`, token);

    expect(res.body.reminderPending).toBe(false);
  });
});
