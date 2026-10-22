const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { ensureDefaultType } = require('../src/services/appointmentTypes');
const { csvCell, noShowRate } = require('../src/services/attendanceReport');
const { clinicDateString } = require('../src/utils/clinicTime');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const report = (token, query = {}) => request(app).get('/api/admin/reports/attendance').query(query).set(bearer(token));
const exportCsv = (token, query = {}) => request(app).get('/api/admin/reports/attendance/export').query(query).set(bearer(token)).buffer(true).parse((res, done) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => done(null, body));
});

// Days of 2030 that do not depend on today's date
const D = (month, day) => `2030-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

// An admin, two doctors and two patients of one clinic, and a second type of visit
async function clinicOf(elsewhere) {
  const admin = await createUser({ role: 'admin', ...(elsewhere && { clinic: elsewhere }) });
  const clinic = { id: admin.user.clinicId };
  const uno = await createUser({ name: 'Dra. Uno', clinic });
  const dos = await createUser({ name: 'Dr. Dos', clinic });
  const patientA = await createPatient({ clinic, name: 'Ana Falta' });
  const patientB = await createPatient({ clinic, name: 'Beto Viene' });
  const consult = await ensureDefaultType(prisma, clinic.id);
  const control = await prisma.appointmentType.create({ data: { clinicId: clinic.id, name: 'Control', durationMinutes: 20, color: '#22c55e' } });
  const make = (doctor, patient, date, time, status, type = consult) =>
    createAppointment({ doctor: doctor.user, patient, date, time, status, typeId: type.id, durationMinutes: type.durationMinutes });
  return { admin, clinic, uno, dos, patientA, patientB, consult, control, make };
}

describe('noShowRate and the CSV cells', () => {
  it('is the share of closed visits that were missed, with one decimal, or null when none is closed', () => {
    expect(noShowRate({ attended: 3, noShow: 1 })).toBe(25);
    expect(noShowRate({ attended: 2, noShow: 1 })).toBe(33.3);
    expect(noShowRate({ attended: 0, noShow: 0 })).toBeNull();
    expect(noShowRate({ attended: 0, noShow: 2 })).toBe(100);
  });

  it('quotes what needs it and defuses what a spreadsheet would run as a formula', () => {
    expect(csvCell('Dra. Uno')).toBe('Dra. Uno');
    expect(csvCell('Pérez, Ana')).toBe('"Pérez, Ana"');
    expect(csvCell('Dice "hola"')).toBe('"Dice ""hola"""');
    expect(csvCell('línea\nnueva')).toBe('"línea\nnueva"');
    for (const bad of ['=SUM(A1)', '+1', '-1', '@cmd', '\tx']) expect(csvCell(bad)).toBe(`'${bad}`);
    expect(csvCell(null)).toBe('');
    expect(csvCell(0)).toBe('0');
  });
});

describe('GET /api/admin/reports/attendance', () => {
  it('counts every status of the period, overall, by doctor and by type', async () => {
    const { admin, uno, dos, patientA, patientB, consult, control, make } = await clinicOf();
    await make(uno, patientA, D(3, 4), '09:00', 'completed', consult);
    await make(uno, patientB, D(3, 4), '10:00', 'arrived', control);
    await make(uno, patientA, D(3, 5), '09:00', 'no_show', consult);
    await make(uno, patientA, D(3, 6), '09:00', 'cancelled', control);
    await make(uno, patientB, D(3, 7), '09:00', 'confirmed', consult);
    await make(dos, patientA, D(3, 4), '09:00', 'no_show', control);
    await make(dos, patientB, D(3, 5), '09:00', 'completed', control);
    await make(dos, patientB, D(3, 6), '09:00', 'scheduled', consult);
    await make(dos, patientB, D(3, 7), '11:00', 'pending_approval', consult);
    await make(dos, patientB, D(3, 7), '12:00', 'in_progress', consult);

    const res = await report(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(res.status).toBe(200);
    expect(res.body.from).toBe(D(3, 1));
    expect(res.body.to).toBe(D(3, 31));
    expect(res.body.doctorId).toBeNull();
    // 10 in all: attended 4 (completed, arrived, completed, in_progress), 2 missed, 1 cancelled, 1 confirmed, 2 not confirmed
    expect(res.body.totals).toEqual({ total: 10, attended: 4, noShow: 2, cancelled: 1, confirmed: 1, notConfirmed: 2, noShowRate: 33.3 });
    expect(res.body.byDoctor).toEqual([
      { doctorId: dos.user.id, name: 'Dr. Dos', total: 5, attended: 2, noShow: 1, cancelled: 0, confirmed: 0, notConfirmed: 2, noShowRate: 33.3 },
      { doctorId: uno.user.id, name: 'Dra. Uno', total: 5, attended: 2, noShow: 1, cancelled: 1, confirmed: 1, notConfirmed: 0, noShowRate: 33.3 }
    ]);
    expect(res.body.byType).toEqual([
      { typeId: consult.id, name: 'Consultation', color: '#0ea5e9', durationMinutes: 30, total: 6, attended: 2, noShow: 1, cancelled: 0, confirmed: 1, notConfirmed: 2, noShowRate: 33.3 },
      { typeId: control.id, name: 'Control', color: '#22c55e', durationMinutes: 20, total: 4, attended: 2, noShow: 1, cancelled: 1, confirmed: 0, notConfirmed: 0, noShowRate: 33.3 }
    ]);
  });

  it('includes both ends of the period and leaves out everything outside it', async () => {
    const { admin, uno, patientA, make } = await clinicOf();
    await make(uno, patientA, D(2, 28), '09:00', 'completed'); // the day before
    await make(uno, patientA, D(3, 1), '09:00', 'completed'); // first day
    await make(uno, patientA, D(3, 31), '09:00', 'no_show'); // last day
    await make(uno, patientA, D(4, 1), '09:00', 'completed'); // the day after

    const res = await report(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(res.body.totals).toMatchObject({ total: 2, attended: 1, noShow: 1, noShowRate: 50 });
    const oneDay = await report(admin.token, { from: D(3, 31), to: D(3, 31) });
    expect(oneDay.body.totals).toMatchObject({ total: 1, noShow: 1, noShowRate: 100 });
  });

  it('narrows to one doctor, in every figure', async () => {
    const { admin, uno, dos, patientA, make } = await clinicOf();
    await make(uno, patientA, D(3, 4), '09:00', 'completed');
    await make(dos, patientA, D(3, 4), '09:00', 'no_show');
    await make(dos, patientA, D(3, 5), '09:00', 'no_show');

    const res = await report(admin.token, { from: D(3, 1), to: D(3, 31), doctorId: dos.user.id });

    expect(res.body.doctorId).toBe(dos.user.id);
    expect(res.body.totals).toMatchObject({ total: 2, noShow: 2, noShowRate: 100 });
    expect(res.body.byDoctor.map((row) => row.name)).toEqual(['Dr. Dos']);
    expect(res.body.noShowByPatient).toEqual([{ patientId: expect.any(String), name: 'Ana Falta', noShows: 2 }]);
  });

  it('has no rate until a visit is closed, and says so with null, not zero', async () => {
    const { admin, uno, patientA, make } = await clinicOf();
    await make(uno, patientA, D(3, 4), '09:00', 'confirmed');
    await make(uno, patientA, D(3, 5), '09:00', 'cancelled');

    const res = await report(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(res.body.totals).toMatchObject({ total: 2, attended: 0, noShow: 0, noShowRate: null });
    expect(res.body.byDoctor[0].noShowRate).toBeNull();
  });

  it('answers with zeros for a period with no appointments', async () => {
    const { admin } = await clinicOf();

    const res = await report(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totals: { total: 0, attended: 0, noShow: 0, cancelled: 0, confirmed: 0, notConfirmed: 0, noShowRate: null },
      byDoctor: [],
      byType: [],
      noShowByPatient: []
    });
  });

  it('lists the patients who miss the most, most first, at most ten', async () => {
    const { admin, uno, patientA, patientB, make } = await clinicOf();
    await make(uno, patientA, D(3, 4), '09:00', 'no_show');
    await make(uno, patientA, D(3, 5), '09:00', 'no_show');
    await make(uno, patientB, D(3, 6), '09:00', 'no_show');
    await make(uno, patientB, D(3, 7), '09:00', 'completed');

    const res = await report(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(res.body.noShowByPatient.map((row) => [row.name, row.noShows])).toEqual([['Ana Falta', 2], ['Beto Viene', 1]]);
  });

  it('counts an appointment booked before types existed (no type) as the default one', async () => {
    const { admin, uno, patientA, consult } = await clinicOf();
    await createAppointment({ doctor: uno.user, patient: patientA, date: D(3, 4), time: '09:00', status: 'completed' }); // no typeId
    await createAppointment({ doctor: uno.user, patient: patientA, date: D(3, 5), time: '09:00', status: 'completed', typeId: consult.id });

    const res = await report(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(res.body.byType).toHaveLength(1);
    expect(res.body.byType[0]).toMatchObject({ typeId: consult.id, name: 'Consultation', total: 2 });
  });

  it('keeps an archived type in the figures of the period it was used in', async () => {
    const { admin, uno, patientA, control, make } = await clinicOf();
    await make(uno, patientA, D(3, 4), '09:00', 'completed', control);
    await prisma.appointmentType.update({ where: { id: control.id }, data: { active: false } });

    const res = await report(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(res.body.byType.map((row) => row.name)).toEqual(['Control']);
  });

  it('never counts another clinic\'s appointments, doctors or patients', async () => {
    const { admin, uno, patientA, make } = await clinicOf();
    await make(uno, patientA, D(3, 4), '09:00', 'no_show');
    const other = await clinicOf(await createClinic());
    await other.make(other.uno, other.patientA, D(3, 4), '09:00', 'completed');
    await other.make(other.uno, other.patientA, D(3, 5), '09:00', 'completed');

    const mine = await report(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(mine.body.totals).toMatchObject({ total: 1, attended: 0, noShow: 1 });
    expect(mine.body.byDoctor.map((row) => row.name)).toEqual(['Dra. Uno']);
    expect(mine.body.byType).toHaveLength(1);
    expect(mine.body.noShowByPatient.map((row) => row.name)).toEqual(['Ana Falta']);
  });

  it('answers 404 for a doctor of another clinic or one that does not exist, and changes nothing', async () => {
    const { admin } = await clinicOf();
    const outsider = await createUser({ clinic: await createClinic() });

    expect((await report(admin.token, { doctorId: outsider.user.id })).status).toBe(404);
    expect((await report(admin.token, { doctorId: '00000000-0000-4000-8000-0000000000aa' })).status).toBe(404);
  });

  it('uses the whole current month when no period is given, upcoming days included', async () => {
    const { admin } = await clinicOf();

    const res = await report(admin.token);

    // The clinic is on Ecuador time (UTC-5): its month can differ from UTC's in the first hours of one
    const today = clinicDateString(new Date(), 'America/Guayaquil');
    const [year, month] = today.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    expect(res.status).toBe(200);
    expect(res.body.from).toBe(`${today.slice(0, 7)}-01`);
    expect(res.body.to).toBe(`${today.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`);
  });

  it('puts an appointment of later this month in the default period', async () => {
    const { admin, uno, patientA, make } = await clinicOf();
    const today = clinicDateString(new Date(), 'America/Guayaquil');
    const [year, month] = today.split('-').map(Number);
    const lastDay = `${today.slice(0, 7)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
    await make(uno, patientA, lastDay, '09:00', 'confirmed');

    const res = await report(admin.token);

    expect(res.body.totals).toMatchObject({ total: 1, confirmed: 1 });
  });

  it.each([
    ['a from that is not a date', { from: '10-03-2030' }, /from must be a valid date/],
    ['an impossible date', { from: '2030-02-30', to: '2030-03-01' }, /from must be a valid date/],
    ['a to that is not a date', { from: D(3, 1), to: 'hoy' }, /to must be a valid date/],
    ['a from after the to', { from: D(3, 10), to: D(3, 1) }, /from must not be after to/],
    ['a period longer than three years', { from: '2030-01-01', to: '2033-01-02' }, /at most 1096 days/],
    ['an empty doctorId', { from: D(3, 1), to: D(3, 2), doctorId: '' }, /doctorId must be an id/]
  ])('rejects %s', async (_label, query, message) => {
    const { admin } = await clinicOf();

    const res = await report(admin.token, query);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('accepts a period of exactly three years', async () => {
    const { admin } = await clinicOf();

    expect((await report(admin.token, { from: '2030-01-01', to: '2032-12-31' })).status).toBe(200);
  });

  it('is for admins only', async () => {
    const { clinic } = await clinicOf();
    for (const role of ['doctor', 'secretary']) {
      const user = await createUser({ role, clinic });
      expect((await report(user.token)).status).toBe(403);
      expect((await exportCsv(user.token)).status).toBe(403);
    }
    expect((await request(app).get('/api/admin/reports/attendance')).status).toBe(401);
    expect((await request(app).get('/api/admin/reports/attendance/export')).status).toBe(401);
  });
});

describe('GET /api/admin/reports/attendance/export', () => {
  it('downloads the figures as a CSV that Excel reads, named after the period', async () => {
    const { admin, uno, dos, patientA, patientB, consult, control, make } = await clinicOf();
    await make(uno, patientA, D(3, 4), '09:00', 'completed', consult);
    await make(uno, patientA, D(3, 5), '09:00', 'no_show', consult);
    await make(dos, patientB, D(3, 4), '09:00', 'completed', control);

    const res = await exportCsv(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="attendance_2030-03-01_2030-03-31.csv"');
    expect(res.headers['cache-control']).toBe('no-store');
    const text = res.body;
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.slice(1).split('\r\n')).toEqual([
      'section,name,total,attended,no_show,cancelled,confirmed,not_confirmed,no_show_rate_percent',
      'total,2030-03-01 to 2030-03-31,3,2,1,0,0,0,33.3',
      'doctor,Dra. Uno,2,1,1,0,0,0,50',
      'doctor,Dr. Dos,1,1,0,0,0,0,0',
      'type,Consultation,2,1,1,0,0,0,50',
      'type,Control,1,1,0,0,0,0,0',
      ''
    ]);
  });

  it('leaves the rate cell empty while nothing is closed, and exports a period with nothing in it', async () => {
    const { admin, uno, patientA, make } = await clinicOf();
    await make(uno, patientA, D(3, 4), '09:00', 'confirmed');

    const withData = await exportCsv(admin.token, { from: D(3, 1), to: D(3, 31) });
    const empty = await exportCsv(admin.token, { from: D(5, 1), to: D(5, 31) });

    expect(withData.body).toContain('total,2030-03-01 to 2030-03-31,1,0,0,0,1,0,\r\n');
    expect(empty.body.slice(1).split('\r\n')).toEqual([
      'section,name,total,attended,no_show,cancelled,confirmed,not_confirmed,no_show_rate_percent',
      'total,2030-05-01 to 2030-05-31,0,0,0,0,0,0,',
      ''
    ]);
  });

  it('never carries a patient\'s name, phone or notes, and defuses formulas in names typed by people', async () => {
    const { admin, clinic, patientA, make } = await clinicOf();
    const sneaky = await createUser({ name: '=HYPERLINK("http://x")', clinic });
    await prisma.appointment.create({
      data: { doctorId: sneaky.user.id, patientId: patientA.id, clinicId: clinic.id, date: D(3, 4), time: '09:00', status: 'no_show', notes: 'dolor de pecho' }
    });
    await make(sneaky, patientA, D(3, 5), '09:00', 'completed');

    const res = await exportCsv(admin.token, { from: D(3, 1), to: D(3, 31) });

    expect(res.body).toContain(`doctor,"'=HYPERLINK(""http://x"")",2,1,1,0,0,0,50`);
    expect(res.body).not.toContain(patientA.name);
    expect(res.body).not.toContain(patientA.phone);
    expect(res.body).not.toContain('dolor');
  });

  it('follows the same filters and limits as the report', async () => {
    const { admin, uno, dos, patientA, make } = await clinicOf();
    await make(uno, patientA, D(3, 4), '09:00', 'completed');
    await make(dos, patientA, D(3, 4), '09:00', 'no_show');
    const outsider = await createUser({ clinic: await createClinic() });

    const one = await exportCsv(admin.token, { from: D(3, 1), to: D(3, 31), doctorId: dos.user.id });

    expect(one.body).toContain('doctor,Dr. Dos,1,0,1,0,0,0,100');
    expect(one.body).not.toContain('Dra. Uno');
    expect((await exportCsv(admin.token, { doctorId: outsider.user.id })).status).toBe(404);
    expect((await exportCsv(admin.token, { from: D(3, 10), to: D(3, 1) })).status).toBe(400);
  });
});
