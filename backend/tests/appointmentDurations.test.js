const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, createAvailability, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');
const { MONDAY } = require('./helpers/time');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});
afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

const book = (token, body) =>
  request(app).post('/api/appointments').set(bearer(token)).send({ patientName: 'Ana Paciente', patientPhone: '+593990000001', date: MONDAY, ...body });
const move = (token, id, body) => request(app).put(`/api/appointments/${id}`).set(bearer(token)).send(body);
const slots = (token, query) => request(app).get('/api/availability/slots').query({ date: MONDAY, ...query }).set(bearer(token));
const times = (res) => res.body.map((s) => s.time);
const free = (res) => res.body.filter((s) => s.status === 'available').map((s) => s.time);

// A doctor who works Monday 08:00-12:00, in a clinic with a 40-minute and a 20-minute type
async function setup({ schedule = true } = {}) {
  const admin = await createUser({ role: 'admin' });
  const clinic = { id: admin.user.clinicId };
  const doctor = await createUser({ clinic });
  if (schedule) await createAvailability({ doctor: doctor.user, dayOfWeek: 1, startTime: '08:00', endTime: '12:00' });
  const makeType = async (name, durationMinutes) =>
    (await request(app).post('/api/appointment-types').set(bearer(admin.token)).send({ name, durationMinutes })).body;
  const long = await makeType('Primera vez', 40);
  const short = await makeType('Control', 20);
  const defaultType = (await request(app).get('/api/appointment-types').set(bearer(admin.token))).body.find((t) => t.isDefault);
  return { admin, doctor, clinic, long, short, defaultType };
}

describe('booking with a type', () => {
  it('uses the clinic\'s default 30-minute type when none is asked for', async () => {
    const { doctor, defaultType } = await setup();

    const res = await book(doctor.token, { time: '09:00' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ durationMinutes: 30, typeId: defaultType.id, type: { id: defaultType.id, name: 'Consultation', durationMinutes: 30 } });
  });

  it('takes the length of the chosen type and keeps it on the appointment', async () => {
    const { doctor, long } = await setup();

    const res = await book(doctor.token, { time: '09:00', typeId: long.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ durationMinutes: 40, typeId: long.id, type: { name: 'Primera vez', color: '#0ea5e9' } });
    const stored = await prisma.appointment.findUnique({ where: { id: res.body.id } });
    expect(stored).toMatchObject({ durationMinutes: 40, typeId: long.id });
  });

  it('lists the type with every appointment', async () => {
    const { doctor, long } = await setup();
    await book(doctor.token, { time: '09:00', typeId: long.id });

    const res = await request(app).get('/api/appointments').set(bearer(doctor.token));

    expect(res.body.appointments[0]).toMatchObject({ durationMinutes: 40, type: { name: 'Primera vez' } });
  });

  it.each([
    ['an id that does not exist', () => '00000000-0000-4000-8000-0000000000aa'],
    ['text that is not an id', () => 'x'],
    ['a number', () => 7]
  ])('rejects %s', async (_label, typeId) => {
    const { doctor } = await setup();

    const res = await book(doctor.token, { time: '09:00', typeId: typeId() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('typeId must be an active appointment type of your clinic');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('rejects a type of another clinic and an archived one', async () => {
    const { admin, doctor, long } = await setup();
    const otherAdmin = await createUser({ role: 'admin', clinic: await createClinic() });
    const foreign = (await request(app).post('/api/appointment-types').set(bearer(otherAdmin.token)).send({ name: 'Ajeno', durationMinutes: 15 })).body;
    await request(app).delete(`/api/appointment-types/${long.id}`).set(bearer(admin.token));

    expect((await book(doctor.token, { time: '09:00', typeId: foreign.id })).status).toBe(400);
    expect((await book(doctor.token, { time: '09:00', typeId: long.id })).status).toBe(400);
    expect(await prisma.appointment.count()).toBe(0);
  });
});

describe('visits that do not overlap', () => {
  it('lets a visit start the moment another one ends, whatever its length', async () => {
    const { doctor, long, short } = await setup();

    expect((await book(doctor.token, { time: '09:00', typeId: long.id })).status).toBe(201); // 09:00-09:40
    expect((await book(doctor.token, { time: '09:40', typeId: short.id, patientPhone: '+593990000002' })).status).toBe(201); // 09:40-10:00
    expect((await book(doctor.token, { time: '10:00', patientPhone: '+593990000003' })).status).toBe(201); // 10:00-10:30
  });

  it.each([
    ['inside a longer visit', '09:30', 'default'],
    ['starting before another ends', '09:20', 'short'],
    ['the same time', '09:00', 'short'],
    ['a visit that would run into the next one', '08:30', 'long']
  ])('refuses a visit %s', async (_label, time, which) => {
    const { doctor, long, short, defaultType } = await setup();
    await book(doctor.token, { time: '09:00', typeId: long.id }); // 09:00-09:40
    const typeId = { long: long.id, short: short.id, default: defaultType.id }[which];

    const res = await book(doctor.token, { time, typeId, patientPhone: '+593990000009' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('An appointment already exists at this time');
  });

  it('refuses a longer visit that would run over one booked after it', async () => {
    const { doctor, long } = await setup();
    await book(doctor.token, { time: '09:30' }); // 09:30-10:00

    const res = await book(doctor.token, { time: '09:00', typeId: long.id, patientPhone: '+593990000002' }); // 09:00-09:40

    expect(res.status).toBe(400);
  });

  it('frees the time when the visit is cancelled', async () => {
    const { doctor, long } = await setup();
    const first = await book(doctor.token, { time: '09:00', typeId: long.id });
    await request(app).delete(`/api/appointments/${first.body.id}`).set(bearer(doctor.token));

    expect((await book(doctor.token, { time: '09:20', patientPhone: '+593990000002' })).status).toBe(201);
  });

  it('does not mix up two doctors of the same clinic', async () => {
    const { clinic, doctor, long } = await setup();
    const other = await createUser({ clinic });
    await book(doctor.token, { time: '09:00', typeId: long.id });

    expect((await book(other.token, { time: '09:00', patientPhone: '+593990000002' })).status).toBe(201);
  });
});

describe('the doctor\'s working hours', () => {
  it('accepts a visit that ends exactly when the block ends', async () => {
    const { doctor } = await setup();

    expect((await book(doctor.token, { time: '11:30' })).status).toBe(201); // 11:30-12:00
  });

  it('refuses a visit that would end after the block, telling it apart from not working at all', async () => {
    const { doctor, long } = await setup();

    const late = await book(doctor.token, { time: '11:30', typeId: long.id }); // 11:30-12:10
    const closed = await book(doctor.token, { time: '12:00' });

    expect(late.status).toBe(400);
    expect(late.body.error).toBe("The appointment does not fit in the doctor's working hours");
    expect(closed.status).toBe(400);
    expect(closed.body.error).toBe('The doctor does not work at the selected time');
  });

  it('cannot run past midnight even for a doctor with no schedule', async () => {
    const { doctor } = await setup({ schedule: false });

    expect((await book(doctor.token, { time: '23:45' })).status).toBe(400);
    expect((await book(doctor.token, { time: '23:30' })).status).toBe(201);
  });
});

describe('changing the type of an appointment', () => {
  it('makes the visit longer or shorter, keeping its time', async () => {
    const { doctor, long, short } = await setup();
    const apt = (await book(doctor.token, { time: '09:00' })).body;

    const longer = await move(doctor.token, apt.id, { typeId: long.id });
    const shorter = await move(doctor.token, apt.id, { typeId: short.id });

    expect(longer.body).toMatchObject({ durationMinutes: 40, type: { name: 'Primera vez' } });
    expect(shorter.body).toMatchObject({ durationMinutes: 20, type: { name: 'Control' } });
  });

  it('answers 409 when the longer visit would run into the next one, and changes nothing', async () => {
    const { doctor, long } = await setup();
    const apt = (await book(doctor.token, { time: '09:00' })).body; // 09:00-09:30
    await book(doctor.token, { time: '09:30', patientPhone: '+593990000002' });

    const res = await move(doctor.token, apt.id, { typeId: long.id });

    expect(res.status).toBe(409);
    expect((await prisma.appointment.findUnique({ where: { id: apt.id } })).durationMinutes).toBe(30);
  });

  it('does not clash with itself when it moves a few minutes inside its own time', async () => {
    const { doctor, long } = await setup();
    const apt = (await book(doctor.token, { time: '09:00', typeId: long.id })).body; // 09:00-09:40

    expect((await move(doctor.token, apt.id, { time: '09:20' })).status).toBe(200); // 09:20-10:00
  });

  it('keeps an archived type on an appointment that is only rescheduled', async () => {
    const { admin, doctor, long } = await setup();
    const apt = (await book(doctor.token, { time: '09:00', typeId: long.id })).body;
    await request(app).delete(`/api/appointment-types/${long.id}`).set(bearer(admin.token));

    const res = await move(doctor.token, apt.id, { time: '10:00', typeId: long.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ time: '10:00', durationMinutes: 40, typeId: long.id });
  });

  it('refuses an archived type, a made-up one and another clinic\'s', async () => {
    const { admin, doctor, long, short } = await setup();
    const apt = (await book(doctor.token, { time: '09:00' })).body;
    const otherAdmin = await createUser({ role: 'admin', clinic: await createClinic() });
    const foreign = (await request(app).post('/api/appointment-types').set(bearer(otherAdmin.token)).send({ name: 'Ajeno', durationMinutes: 15 })).body;
    await request(app).delete(`/api/appointment-types/${short.id}`).set(bearer(admin.token));

    for (const typeId of [short.id, foreign.id, '00000000-0000-4000-8000-0000000000aa']) {
      expect((await move(doctor.token, apt.id, { typeId })).status).toBe(400);
    }
    expect((await move(doctor.token, apt.id, { typeId: '' })).status).toBe(400);
    expect((await prisma.appointment.findUnique({ where: { id: apt.id } })).durationMinutes).toBe(30);
    expect(long.id).toBeTruthy();
  });

  it('records the change in the audit log when staff do it, without the id', async () => {
    const { admin, doctor, long } = await setup();
    const apt = await createAppointment({ doctor: doctor.user, patient: await createPatient({ clinic: { id: admin.user.clinicId } }), date: MONDAY, time: '09:00' });

    await move(admin.token, apt.id, { typeId: long.id });

    const entry = await prisma.auditLog.findFirst({ where: { entityId: apt.id, action: 'update' } });
    expect(entry.changes).toEqual({ typeId: { changed: true } });
  });
});

describe('GET /api/availability/slots with a type', () => {
  it('offers a slot every 30 minutes by default, as before types existed', async () => {
    const { doctor } = await setup();

    const res = await slots(doctor.token);

    expect(times(res)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('offers a slot every `duration` minutes, and none that would end after the block', async () => {
    const { doctor, long, short } = await setup();

    const forLong = await slots(doctor.token, { typeId: long.id }); // 40 min in 08:00-12:00
    const forShort = await slots(doctor.token, { typeId: short.id });

    expect(times(forLong)).toEqual(['08:00', '08:40', '09:20', '10:00', '10:40', '11:20']);
    expect(times(forShort)).toHaveLength(12);
    expect(times(forShort).slice(0, 3)).toEqual(['08:00', '08:20', '08:40']);
    expect(times(forShort).at(-1)).toBe('11:40');
  });

  it('marks as booked every slot that overlaps a visit, whatever its length', async () => {
    const { doctor, long } = await setup();
    await book(doctor.token, { time: '09:00', typeId: long.id }); // 09:00-09:40

    const res = await slots(doctor.token); // 30-minute slots

    expect(res.body.filter((s) => s.status === 'booked').map((s) => s.time)).toEqual(['09:00', '09:30']);
  });

  it('adds a slot right where a visit ends, so no time is lost', async () => {
    const { doctor, long } = await setup();
    await book(doctor.token, { time: '09:00', typeId: long.id }); // ends 09:40

    const res = await slots(doctor.token);

    expect(free(res)).toEqual(['08:00', '08:30', '09:40', '10:00', '10:30', '11:00', '11:30']);
  });

  it('does not offer a slot that would run into the next visit as free', async () => {
    const { doctor, short } = await setup();
    await book(doctor.token, { time: '08:30' }); // 08:30-09:00

    const res = await slots(doctor.token, { typeId: short.id }); // 20 minutes

    expect(res.body.find((s) => s.time === '08:20').status).toBe('booked'); // 08:20-08:40 overlaps
    expect(res.body.find((s) => s.time === '08:00').status).toBe('available'); // 08:00-08:20 fits before it
  });

  it('shows the slots again when the visit is cancelled', async () => {
    const { doctor, long } = await setup();
    const apt = await book(doctor.token, { time: '09:00', typeId: long.id });
    await request(app).delete(`/api/appointments/${apt.body.id}`).set(bearer(doctor.token));

    expect((await slots(doctor.token)).body.every((s) => s.status === 'available')).toBe(true);
  });

  it('only offers what booking accepts: every free slot can be booked', async () => {
    const { doctor, long } = await setup();
    await book(doctor.token, { time: '09:00' }); // 09:00-09:30
    const res = await slots(doctor.token, { typeId: long.id });

    for (const time of free(res)) {
      const booking = await book(doctor.token, { time, typeId: long.id, patientPhone: `+59399${time.replace(':', '')}00` });
      expect([time, booking.status]).toEqual([time, 201]);
      await request(app).delete(`/api/appointments/${booking.body.id}`).set(bearer(doctor.token));
    }
  });

  it('answers 400 for an archived type, another clinic\'s or a made-up one', async () => {
    const { admin, doctor, long } = await setup();
    const otherAdmin = await createUser({ role: 'admin', clinic: await createClinic() });
    const foreign = (await request(app).post('/api/appointment-types').set(bearer(otherAdmin.token)).send({ name: 'Ajeno', durationMinutes: 15 })).body;
    await request(app).delete(`/api/appointment-types/${long.id}`).set(bearer(admin.token));

    for (const typeId of [long.id, foreign.id, 'x']) {
      const res = await slots(doctor.token, { typeId });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('typeId must be an active appointment type of your clinic');
    }
  });
});
