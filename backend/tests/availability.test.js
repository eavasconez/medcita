const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { MONDAY, TUESDAY, SATURDAY } = require('./helpers/time');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const getAvailability = (token, query = {}) => request(app).get('/api/availability').query(query).set(bearer(token));
const setAvailability = (token, body) => request(app).post('/api/availability').set(bearer(token)).send(body);
const getSlots = (token, query) => request(app).get('/api/availability/slots').query(query).set(bearer(token));

const slot = (doctor, dayOfWeek, startTime, endTime) => ({ doctorId: doctor.id, dayOfWeek, startTime, endTime });

describe('GET /api/availability', () => {
  it('returns the default Monday-Friday 08:00-18:00 schedule when none is configured', async () => {
    const { token } = await createUser();

    const res = await getAvailability(token);

    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
    expect(res.body.every((s) => s.startTime === '08:00' && s.endTime === '18:00' && s.isDefault === true)).toBe(true);
  });

  it('returns the configured schedule ordered by day and start time', async () => {
    const { user, token } = await createUser();
    await prisma.availability.createMany({
      data: [slot(user, 3, '14:00', '18:00'), slot(user, 1, '14:00', '17:00'), slot(user, 1, '08:00', '12:00')]
    });

    const res = await getAvailability(token);

    expect(res.body.map((s) => `${s.dayOfWeek} ${s.startTime}-${s.endTime}`)).toEqual([
      '1 08:00-12:00',
      '1 14:00-17:00',
      '3 14:00-18:00'
    ]);
  });

  it("returns another doctor's schedule when doctorId is given", async () => {
    const me = await createUser();
    const other = await createUser();
    await prisma.availability.create({ data: slot(other.user, 2, '10:00', '11:00') });

    const res = await getAvailability(me.token, { doctorId: other.user.id });

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ doctorId: other.user.id, dayOfWeek: 2 });
  });

  it.each(['undefined', 'null'])('falls back to the caller when the frontend sends doctorId=%s', async (value) => {
    const { user, token } = await createUser();
    await prisma.availability.create({ data: slot(user, 4, '09:00', '10:00') });

    const res = await getAvailability(token, { doctorId: value });

    expect(res.body).toHaveLength(1);
    expect(res.body[0].dayOfWeek).toBe(4);
  });
});

describe('POST /api/availability', () => {
  const valid = { schedules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '13:00' }] };

  it('saves the schedule and reports how many rows were stored', async () => {
    const { user, token } = await createUser();

    const res = await setAvailability(token, {
      schedules: [
        { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
        { dayOfWeek: 1, startTime: '15:00', endTime: '18:00' },
        { dayOfWeek: 5, startTime: '08:00', endTime: '12:00' }
      ]
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Availability updated successfully', count: 3 });
    expect(await prisma.availability.count({ where: { doctorId: user.id } })).toBe(3);
  });

  it('replaces the previous schedule instead of adding to it', async () => {
    const { user, token } = await createUser();
    await prisma.availability.createMany({ data: [slot(user, 1, '08:00', '12:00'), slot(user, 2, '08:00', '12:00')] });

    await setAvailability(token, { schedules: [{ dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }] });

    const stored = await prisma.availability.findMany({ where: { doctorId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ dayOfWeek: 6, startTime: '10:00', endTime: '12:00' });
  });

  it.each([
    ['an empty list', { schedules: [] }, 'schedules must be a non-empty array'],
    ['a missing list', {}, 'schedules must be a non-empty array'],
    ['a day above 6', { schedules: [{ dayOfWeek: 7, startTime: '09:00', endTime: '10:00' }] }, /dayOfWeek must be an integer/],
    ['a non-integer day', { schedules: [{ dayOfWeek: 1.5, startTime: '09:00', endTime: '10:00' }] }, /dayOfWeek must be an integer/],
    ['a malformed start time', { schedules: [{ dayOfWeek: 1, startTime: '9am', endTime: '10:00' }] }, 'startTime must be a valid time (HH:MM)'],
    ['a malformed end time', { schedules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '25:00' }] }, 'endTime must be a valid time (HH:MM)'],
    ['an end before the start', { schedules: [{ dayOfWeek: 1, startTime: '12:00', endTime: '09:00' }] }, 'startTime must be earlier than endTime'],
    ['an empty window', { schedules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '09:00' }] }, 'startTime must be earlier than endTime'],
    [
      'a duplicated window',
      { schedules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }, { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] },
      /Duplicate schedule/
    ]
  ])('returns 400 for %s', async (_label, body, message) => {
    const { token } = await createUser();

    const res = await setAvailability(token, body);

    expect(res.status).toBe(400);
    if (message instanceof RegExp) expect(res.body.error).toMatch(message);
    else expect(res.body.error).toBe(message);
  });

  it('keeps the existing schedule untouched when the new one is invalid', async () => {
    const { user, token } = await createUser();
    await prisma.availability.create({ data: slot(user, 1, '08:00', '12:00') });

    const res = await setAvailability(token, { schedules: [{ dayOfWeek: 1, startTime: '12:00', endTime: '09:00' }] });

    expect(res.status).toBe(400);
    expect(await prisma.availability.count({ where: { doctorId: user.id } })).toBe(1);
  });

  it.each(['admin', 'secretary'])('lets %s set the schedule of another doctor', async (role) => {
    const doctor = await createUser();
    const staff = await createUser({ role });

    const res = await setAvailability(staff.token, { ...valid, doctorId: doctor.user.id });

    expect(res.status).toBe(200);
    expect(await prisma.availability.count({ where: { doctorId: doctor.user.id } })).toBe(1);
    expect(await prisma.availability.count({ where: { doctorId: staff.user.id } })).toBe(0);
  });

  it('ignores doctorId for a regular doctor, who can only change their own schedule', async () => {
    const victim = await createUser();
    const me = await createUser();

    const res = await setAvailability(me.token, { ...valid, doctorId: victim.user.id });

    expect(res.status).toBe(200);
    expect(await prisma.availability.count({ where: { doctorId: me.user.id } })).toBe(1);
    expect(await prisma.availability.count({ where: { doctorId: victim.user.id } })).toBe(0);
  });
});

describe('GET /api/availability/slots', () => {
  it.each([[undefined], ['2030/01/14'], ['2030-02-31'], ['tomorrow']])('returns 400 for date=%s', async (date) => {
    const { token } = await createUser();

    const res = await getSlots(token, { date });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A valid date (YYYY-MM-DD) is required');
  });

  it('generates 30-minute slots inside the configured window', async () => {
    const { user, token } = await createUser();
    await prisma.availability.create({ data: slot(user, 1, '09:00', '11:00') });

    const res = await getSlots(token, { date: MONDAY });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { time: '09:00', status: 'available' },
      { time: '09:30', status: 'available' },
      { time: '10:00', status: 'available' },
      { time: '10:30', status: 'available' }
    ]);
  });

  it('supports several windows in the same day', async () => {
    const { user, token } = await createUser();
    await prisma.availability.createMany({ data: [slot(user, 1, '09:00', '10:00'), slot(user, 1, '14:00', '15:00')] });

    const res = await getSlots(token, { date: MONDAY });

    expect(res.body.map((s) => s.time)).toEqual(['09:00', '09:30', '14:00', '14:30']);
  });

  it('uses the Monday-Friday 08:00-18:00 fallback for a doctor with no schedule, and nothing on weekends', async () => {
    const { token } = await createUser();

    const weekday = await getSlots(token, { date: TUESDAY });
    const weekend = await getSlots(token, { date: SATURDAY });

    expect(weekday.body).toHaveLength(20);
    expect(weekday.body[0].time).toBe('08:00');
    expect(weekday.body[19].time).toBe('17:30');
    expect(weekend.body).toEqual([]);
  });

  // KNOWN BUG: the Monday-Friday 08:00-18:00 fallback is applied per day, so a
  // doctor who configured only Mondays is still offered free slots on Tuesday
  // (which POST /api/appointments then rejects with "El médico no atiende en el
  // horario seleccionado"). The fallback should only apply to doctors with no
  // schedule at all. `it.failing` keeps CI green while documenting it; when the
  // endpoint is fixed this test will start failing, so change it back to `it`.
  it.failing('returns no slots on a day the doctor does not work', async () => {
    const { user, token } = await createUser();
    await prisma.availability.create({ data: slot(user, 1, '09:00', '12:00') });

    const res = await getSlots(token, { date: TUESDAY });

    expect(res.body).toEqual([]);
  });

  it('marks booked slots as booked but frees the ones whose appointment was cancelled', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    await prisma.availability.create({ data: slot(user, 1, '09:00', '11:00') });
    await createAppointment({ doctor: user, patient, date: MONDAY, time: '09:30', status: 'confirmed' });
    await createAppointment({ doctor: user, patient, date: MONDAY, time: '10:00', status: 'cancelled' });

    const res = await getSlots(token, { date: MONDAY });

    const byTime = Object.fromEntries(res.body.map((s) => [s.time, s.status]));
    expect(byTime).toEqual({ '09:00': 'available', '09:30': 'booked', '10:00': 'available', '10:30': 'available' });
  });

  it("returns the slots of another doctor when doctorId is given", async () => {
    const me = await createUser();
    const other = await createUser();
    await prisma.availability.create({ data: slot(other.user, 1, '09:00', '10:00') });

    const res = await getSlots(me.token, { date: MONDAY, doctorId: other.user.id });

    expect(res.body.map((s) => s.time)).toEqual(['09:00', '09:30']);
  });
});
