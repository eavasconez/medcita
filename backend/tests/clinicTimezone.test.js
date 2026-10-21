const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { clinicParts, MONDAY, TUESDAY } = require('./helpers/time');
const { appointmentInstant, clinicDateString, clinicDateTime, isValidTimezone } = require('../src/utils/clinicTime');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

// The suite runs with TZ=UTC (tests/globalSetup.js), so nothing here depends on the
// machine's own zone.
describe('clinicTime', () => {
  it('reads a clinic-local appointment in Ecuador mainland (UTC-5, the default) and in Galápagos (UTC-6)', () => {
    expect(appointmentInstant('2030-01-14', '10:00').toISOString()).toBe('2030-01-14T15:00:00.000Z');
    expect(appointmentInstant('2030-01-14', '10:00', 'America/Guayaquil').toISOString()).toBe('2030-01-14T15:00:00.000Z');
    expect(appointmentInstant('2030-01-14', '10:00', 'Pacific/Galapagos').toISOString()).toBe('2030-01-14T16:00:00.000Z');
  });

  it('follows daylight saving time of a clinic outside Ecuador', () => {
    expect(appointmentInstant('2030-07-01', '10:00', 'America/New_York').toISOString()).toBe('2030-07-01T14:00:00.000Z'); // UTC-4
    expect(appointmentInstant('2030-12-02', '10:00', 'America/New_York').toISOString()).toBe('2030-12-02T15:00:00.000Z'); // UTC-5
    expect(appointmentInstant('2030-01-14', '10:00', 'Asia/Kolkata').toISOString()).toBe('2030-01-14T04:30:00.000Z'); // UTC+5:30
  });

  it('tells the calendar date and time of an instant in each zone, around midnight', () => {
    const instant = new Date('2030-01-15T03:30:00Z');
    expect(clinicDateTime(instant, 'America/Guayaquil')).toEqual({ date: '2030-01-14', time: '22:30' });
    expect(clinicDateTime(instant, 'Pacific/Galapagos')).toEqual({ date: '2030-01-14', time: '21:30' });
    expect(clinicDateTime(instant, 'Asia/Tokyo')).toEqual({ date: '2030-01-15', time: '12:30' });
    expect(clinicDateString(new Date('2030-01-15T05:00:00Z'))).toBe('2030-01-15'); // midnight in Ecuador, never "24:00"
    expect(clinicDateTime(new Date('2030-01-15T05:00:00Z')).time).toBe('00:00');
  });

  it('accepts only real IANA zone names', () => {
    for (const ok of ['America/Guayaquil', 'Pacific/Galapagos', 'America/Bogota', 'Europe/Madrid', 'UTC']) {
      expect(isValidTimezone(ok)).toBe(true);
    }
    for (const bad of ['', 'Mars/Olympus', '+05:00', 'GMT+5', 'america/guayaquil', null, undefined, 5, {}]) {
      expect(isValidTimezone(bad)).toBe(false);
    }
  });
});

describe('two clinics in different zones', () => {
  const freezeClock = (iso) =>
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'performance', 'hrtime']
    });
  afterEach(() => jest.useRealTimers());

  const getSlots = (token, date) => request(app).get('/api/availability/slots').query({ date }).set(bearer(token));
  const monday = (doctor) => ({ doctorId: doctor.id, clinicId: doctor.clinicId, dayOfWeek: 1, startTime: '08:00', endTime: '12:00' });

  it('drops the slots that already passed by each clinic\'s own clock', async () => {
    freezeClock('2030-01-14T16:15:00Z'); // 11:15 in Ecuador, 10:15 in Galápagos, 01:15 on Tuesday in Tokyo
    const ecuador = await createUser();
    const galapagos = await createUser({ clinic: await createClinic({ timezone: 'Pacific/Galapagos' }) });
    await prisma.availability.create({ data: monday(ecuador.user) });
    await prisma.availability.create({ data: monday(galapagos.user) });

    const inEcuador = await getSlots(ecuador.token, MONDAY);
    const inGalapagos = await getSlots(galapagos.token, MONDAY);

    expect(inEcuador.body.map((s) => s.time)).toEqual(['11:30']);
    expect(inGalapagos.body.map((s) => s.time)).toEqual(['10:30', '11:00', '11:30']);
  });

  it('knows which day it is where the clinic is, not where the server is', async () => {
    freezeClock('2030-01-14T16:15:00Z'); // still Monday in UTC, but already 01:15 on Tuesday in Tokyo
    const tokyo = await createUser({ clinic: await createClinic({ timezone: 'Asia/Tokyo' }) });
    await prisma.availability.create({
      data: { doctorId: tokyo.user.id, clinicId: tokyo.user.clinicId, dayOfWeek: 2, startTime: '00:00', endTime: '03:00' }
    });

    const res = await getSlots(tokyo.token, TUESDAY);

    // Read as the server's Monday, nothing of Tuesday would count as passed
    expect(res.body.map((s) => s.time)).toEqual(['01:30', '02:00', '02:30']);
  });

  it('lists as unclosed the appointments whose time passed in the clinic\'s zone', async () => {
    const { user, token } = await createUser({ clinic: await createClinic({ timezone: 'Asia/Tokyo' }) });
    const patient = await createPatient({ clinic: { id: user.clinicId } });
    // Wall clock "one hour ago" in Tokyo: it is in the past there
    const past = clinicParts(-1, Date.now(), 'Asia/Tokyo');
    // Wall clock "ten hours ahead" in Tokyo is still in the future there (and would look past read as Ecuador's)
    const future = clinicParts(10, Date.now(), 'Asia/Tokyo');
    const passed = await createAppointment({ doctor: user, patient, ...past, status: 'confirmed' });
    await createAppointment({ doctor: user, patient, ...future, status: 'confirmed' });

    const res = await request(app).get('/api/appointments/unclosed').set(bearer(token));

    expect(res.body.appointments.map((a) => a.id)).toEqual([passed.id]);
  });
});

describe('PUT /api/admin/clinic (timezone)', () => {
  const update = (token, body) => request(app).put('/api/admin/clinic').set(bearer(token)).send(body);

  it('changes the timezone of the admin\'s own clinic only, keeping its name', async () => {
    const other = await createClinic({ name: 'Otra Clínica' });
    const { user, token } = await createUser({ role: 'admin', clinic: await createClinic({ name: 'Consultorio Torres' }) });

    const res = await update(token, { timezone: 'Pacific/Galapagos' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.clinicId, name: 'Consultorio Torres', timezone: 'Pacific/Galapagos' });
    expect((await prisma.clinic.findUnique({ where: { id: other.id } })).timezone).toBe('America/Guayaquil');
  });

  it('can change the name and the timezone together', async () => {
    const { token } = await createUser({ role: 'admin' });

    const res = await update(token, { name: 'Clínica Nueva', timezone: 'America/Bogota' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Clínica Nueva', timezone: 'America/Bogota' });
  });

  it('is applied to the next request: the profile and the slots use the new zone', async () => {
    const { user, token } = await createUser({ role: 'admin' });
    await update(token, { timezone: 'Asia/Tokyo' });

    const profile = await request(app).get('/api/auth/profile').set(bearer(token));
    expect(profile.body.clinic.timezone).toBe('Asia/Tokyo');

    // The same stored text now means another instant
    expect(appointmentInstant('2030-01-14', '10:00', profile.body.clinic.timezone).toISOString()).toBe('2030-01-14T01:00:00.000Z');
    expect(user.clinicId).toBe(profile.body.clinic.id);
  });

  it.each([
    ['not a zone name', 'Mars/Olympus'],
    ['an offset', '+05:00'],
    ['empty', ''],
    ['a number', 5]
  ])('rejects a timezone that is %s', async (_label, timezone) => {
    const { user, token } = await createUser({ role: 'admin' });

    const res = await update(token, { timezone });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('timezone must be a valid IANA timezone (e.g. America/Guayaquil)');
    expect((await prisma.clinic.findUnique({ where: { id: user.clinicId } })).timezone).toBe('America/Guayaquil');
  });

  it('still asks for a name when nothing to change is sent', async () => {
    const { token } = await createUser({ role: 'admin' });

    const res = await update(token, {});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Clinic name must be between 2 and 80 characters');
  });

  it('is for admins only', async () => {
    const { clinic } = { clinic: await createClinic() };
    for (const role of ['secretary', 'doctor']) {
      const user = await createUser({ role, clinic });
      expect((await update(user.token, { timezone: 'Asia/Tokyo' })).status).toBe(403);
    }
    expect((await prisma.clinic.findUnique({ where: { id: clinic.id } })).timezone).toBe('America/Guayaquil');
  });
});
