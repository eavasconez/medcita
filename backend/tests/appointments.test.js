const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');
const { MONDAY, TUESDAY } = require('./helpers/time');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});

afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

const booking = (overrides = {}) => ({
  patientName: 'María Andrade',
  patientPhone: '+593990000042',
  date: TUESDAY,
  time: '10:00',
  ...overrides
});

const post = (token, body) => request(app).post('/api/appointments').set(bearer(token)).send(body);

describe('POST /api/appointments', () => {
  it('books an appointment as pending_approval and creates the patient', async () => {
    const { user, token } = await createUser();

    const res = await post(token, booking({ patientEmail: 'maria@example.test', notes: 'Control' }));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      doctorId: user.id,
      date: TUESDAY,
      time: '10:00',
      status: 'pending_approval',
      notes: 'Control',
      reminderSentAt: null
    });
    expect(res.body.Patient).toMatchObject({ name: 'María Andrade', phone: '+593990000042', email: 'maria@example.test' });
    expect(await prisma.appointment.count()).toBe(1);
  });

  it('sends the confirmation to the patient (WhatsApp + email) and a notice to the doctor', async () => {
    const { user, token } = await createUser({ name: 'Dr. House', email: 'house@example.test' });

    await post(token, booking({ patientEmail: 'maria@example.test' }));

    const whatsapp = notifications.sent.filter((m) => m.channel === 'whatsapp');
    expect(whatsapp).toHaveLength(1);
    expect(whatsapp[0].to).toBe('+593990000042');
    expect(whatsapp[0].message).toContain(`${TUESDAY} a las 10:00`);
    expect(whatsapp[0].message).toContain(user.name);

    const emails = notifications.sent.filter((m) => m.channel === 'email');
    expect(emails.map((m) => m.to).sort()).toEqual(['house@example.test', 'maria@example.test']);
    expect(emails.find((m) => m.to === 'maria@example.test').subject).toMatch(/Confirmación de Cita/);
    expect(emails.find((m) => m.to === 'house@example.test').subject).toMatch(/Nueva Cita Agendada/);
  });

  it('does not email the patient when no email was given', async () => {
    const { token } = await createUser({ email: 'house@example.test' });

    await post(token, booking());

    const emails = notifications.sent.filter((m) => m.channel === 'email');
    expect(emails.map((m) => m.to)).toEqual(['house@example.test']);
  });

  it.each([
    ['missing patient name', { patientName: '  ' }, 'Patient name is required'],
    ['missing patient phone', { patientPhone: undefined }, 'Patient phone is required'],
    ['malformed date', { date: '15/01/2030' }, 'A valid date (YYYY-MM-DD) is required'],
    ['impossible date', { date: '2030-02-31' }, 'A valid date (YYYY-MM-DD) is required'],
    ['missing date', { date: undefined }, 'A valid date (YYYY-MM-DD) is required'],
    ['out-of-range time', { time: '24:00' }, 'A valid time (HH:MM) is required'],
    ['time without leading zero', { time: '9:00' }, 'A valid time (HH:MM) is required']
  ])('returns 400 for %s', async (_label, overrides, message) => {
    const { token } = await createUser();

    const res = await post(token, booking(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('stores blank cedula/email as null so two patients without them do not collide', async () => {
    const { token } = await createUser();

    const first = await post(token, booking({ patientPhone: '+593990000001', time: '09:00', patientCedula: '', patientEmail: '' }));
    const second = await post(token, booking({ patientPhone: '+593990000002', time: '09:30', patientCedula: '', patientEmail: '' }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const patients = await prisma.patient.findMany();
    expect(patients).toHaveLength(2);
    expect(patients.every((p) => p.cedula === null && p.email === null)).toBe(true);
  });

  it('keeps the stored email and cedula when an existing patient rebooks leaving them blank', async () => {
    const { token } = await createUser();
    await post(token, booking({ patientEmail: 'maria@example.test', patientCedula: '1712345678', time: '09:00' }));

    const res = await post(token, booking({ patientName: 'María A. Andrade', time: '09:30', patientEmail: '', patientCedula: '' }));

    expect(res.status).toBe(201);
    const patient = await prisma.patient.findUnique({ where: { phone: '+593990000042' } });
    expect(patient).toMatchObject({ name: 'María A. Andrade', email: 'maria@example.test', cedula: '1712345678' });
    expect(await prisma.patient.count()).toBe(1);
  });

  describe('schedule conflicts', () => {
    it('rejects a second appointment for the same doctor, date and time', async () => {
      const { token } = await createUser();
      await post(token, booking());

      const res = await post(token, booking({ patientName: 'Otro Paciente', patientPhone: '+593990000099' }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Ya existe una cita en este horario');
      expect(await prisma.appointment.count()).toBe(1);
    });

    it('frees the slot once the appointment is cancelled', async () => {
      const { user, token } = await createUser();
      const patient = await createPatient();
      await createAppointment({ doctor: user, patient, date: TUESDAY, time: '10:00', status: 'cancelled' });

      const res = await post(token, booking());

      expect(res.status).toBe(201);
    });

    it('allows the same slot for a different doctor', async () => {
      const a = await createUser();
      const b = await createUser();
      await post(a.token, booking());

      const res = await post(b.token, booking({ patientName: 'Otro', patientPhone: '+593990000077' }));

      expect(res.status).toBe(201);
    });

    it('lets exactly one of several simultaneous requests take the slot', async () => {
      const { token } = await createUser();

      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          post(token, booking({ patientName: `Paciente ${i}`, patientPhone: `+59399000010${i}` }))
        )
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      // The losers get a clean conflict (400) or, if serialization retries ran out, 409.
      expect(statuses.filter((s) => s !== 201).every((s) => s === 400 || s === 409)).toBe(true);
      expect(await prisma.appointment.count({ where: { date: TUESDAY, time: '10:00' } })).toBe(1);
    });
  });

  describe('doctor availability', () => {
    it('allows bookings inside the doctor schedule and rejects the rest', async () => {
      const { user, token } = await createUser();
      await prisma.availability.create({ data: { doctorId: user.id, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' } });

      const inside = await post(token, booking({ date: MONDAY, time: '10:00' }));
      const afterHours = await post(token, booking({ date: MONDAY, time: '15:00', patientPhone: '+593990000003' }));
      const otherDay = await post(token, booking({ date: TUESDAY, time: '10:00', patientPhone: '+593990000004' }));

      expect(inside.status).toBe(201);
      expect(afterHours.status).toBe(400);
      expect(afterHours.body.error).toBe('El médico no atiende en el horario seleccionado');
      expect(otherDay.status).toBe(400);
      expect(otherDay.body.error).toBe('El médico no atiende en el horario seleccionado');
    });

    it('does not restrict a doctor who has not configured any schedule', async () => {
      const { token } = await createUser();

      const res = await post(token, booking({ date: MONDAY, time: '23:30' }));

      expect(res.status).toBe(201);
    });
  });

  describe('booking on behalf of a doctor', () => {
    it.each(['admin', 'secretary'])('lets %s book for another doctor through doctorId', async (role) => {
      const doctor = await createUser();
      const staff = await createUser({ role });

      const res = await post(staff.token, booking({ doctorId: doctor.user.id }));

      expect(res.status).toBe(201);
      expect(res.body.doctorId).toBe(doctor.user.id);
    });

    it('ignores doctorId when the caller is a regular doctor', async () => {
      const other = await createUser();
      const me = await createUser();

      const res = await post(me.token, booking({ doctorId: other.user.id }));

      expect(res.status).toBe(201);
      expect(res.body.doctorId).toBe(me.user.id);
    });
  });
});

describe('GET /api/appointments', () => {
  it('lists only the appointments of the authenticated doctor, ordered by date and time', async () => {
    const a = await createUser();
    const b = await createUser();
    const patient = await createPatient({ name: 'Paciente Uno' });
    await createAppointment({ doctor: a.user, patient, date: TUESDAY, time: '11:00' });
    await createAppointment({ doctor: a.user, patient, date: MONDAY, time: '15:00' });
    await createAppointment({ doctor: a.user, patient, date: TUESDAY, time: '09:00' });
    await createAppointment({ doctor: b.user, patient, date: TUESDAY, time: '10:00' });

    const res = await request(app).get('/api/appointments').set(bearer(a.token));

    expect(res.status).toBe(200);
    expect(res.body.map((x) => `${x.date} ${x.time}`)).toEqual([`${MONDAY} 15:00`, `${TUESDAY} 09:00`, `${TUESDAY} 11:00`]);
    expect(res.body[0].Patient.name).toBe('Paciente Uno');
    expect(res.body[0].doctor.name).toBe(a.user.name);
  });

  it('filters by date, status and patient', async () => {
    const { user, token } = await createUser();
    const p1 = await createPatient();
    const p2 = await createPatient();
    await createAppointment({ doctor: user, patient: p1, date: MONDAY, time: '09:00', status: 'confirmed' });
    await createAppointment({ doctor: user, patient: p1, date: TUESDAY, time: '09:00', status: 'pending_approval' });
    await createAppointment({ doctor: user, patient: p2, date: TUESDAY, time: '10:00', status: 'confirmed' });

    const byDate = await request(app).get('/api/appointments').query({ date: TUESDAY }).set(bearer(token));
    const byStatus = await request(app).get('/api/appointments').query({ status: 'confirmed' }).set(bearer(token));
    const byPatient = await request(app).get('/api/appointments').query({ patientId: p2.id }).set(bearer(token));

    expect(byDate.body).toHaveLength(2);
    expect(byStatus.body).toHaveLength(2);
    expect(byPatient.body).toHaveLength(1);
    expect(byPatient.body[0].patientId).toBe(p2.id);
  });

  it.each(['admin', 'secretary'])('lets %s see every doctor and filter by doctorId', async (role) => {
    const a = await createUser();
    const b = await createUser();
    const staff = await createUser({ role });
    const patient = await createPatient();
    await createAppointment({ doctor: a.user, patient, date: TUESDAY, time: '09:00' });
    await createAppointment({ doctor: b.user, patient, date: TUESDAY, time: '10:00' });

    const all = await request(app).get('/api/appointments').set(bearer(staff.token));
    const onlyB = await request(app).get('/api/appointments').query({ doctorId: b.user.id }).set(bearer(staff.token));

    expect(all.body).toHaveLength(2);
    expect(onlyB.body).toHaveLength(1);
    expect(onlyB.body[0].doctorId).toBe(b.user.id);
  });
});

describe('PUT /api/appointments/:id', () => {
  const setup = async () => {
    const owner = await createUser();
    const patient = await createPatient();
    const appointment = await createAppointment({ doctor: owner.user, patient, date: TUESDAY, time: '10:00' });
    return { owner, patient, appointment };
  };
  const put = (token, id, body) => request(app).put(`/api/appointments/${id}`).set(bearer(token)).send(body);

  it('updates status, date, time and notes', async () => {
    const { owner, appointment } = await setup();

    const res = await put(owner.token, appointment.id, { status: 'confirmed', date: MONDAY, time: '11:30', notes: 'Trae exámenes' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'confirmed', date: MONDAY, time: '11:30', notes: 'Trae exámenes' });
    expect(res.body.Patient).toBeDefined();
  });

  it.each(['scheduled', 'pending_approval', 'confirmed', 'completed', 'cancelled'])('accepts status %s', async (status) => {
    const { owner, appointment } = await setup();

    const res = await put(owner.token, appointment.id, { status });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(status);
  });

  it.each([
    ['unknown status', { status: 'done' }, /Status must be one of/],
    ['malformed date', { date: '2030/01/15' }, /valid date/],
    ['malformed time', { time: '25:61' }, /valid time/]
  ])('returns 400 for %s', async (_label, body, message) => {
    const { owner, appointment } = await setup();

    const res = await put(owner.token, appointment.id, body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it("does not let a doctor modify another doctor's appointment", async () => {
    const { appointment } = await setup();
    const intruder = await createUser();

    const res = await put(intruder.token, appointment.id, { status: 'cancelled' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Appointment not found');
    expect((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status).toBe('pending_approval');
  });

  it.each(['admin', 'secretary'])('lets %s modify any appointment', async (role) => {
    const { appointment } = await setup();
    const staff = await createUser({ role });

    const res = await put(staff.token, appointment.id, { status: 'confirmed' });

    expect(res.status).toBe(200);
  });

  it('returns 404 for an unknown appointment id', async () => {
    const { token } = await createUser();

    const res = await put(token, '00000000-0000-4000-8000-000000000000', { status: 'confirmed' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/appointments/:id', () => {
  const setup = async () => {
    const owner = await createUser();
    const patient = await createPatient();
    const appointment = await createAppointment({ doctor: owner.user, patient, date: TUESDAY, time: '10:00' });
    return { owner, appointment };
  };
  const del = (token, id) => request(app).delete(`/api/appointments/${id}`).set(bearer(token));

  it('lets a doctor delete their own appointment', async () => {
    const { owner, appointment } = await setup();

    const res = await del(owner.token, appointment.id);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Appointment cancelled successfully');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it("does not let a doctor delete another doctor's appointment", async () => {
    const { appointment } = await setup();
    const intruder = await createUser();

    const res = await del(intruder.token, appointment.id);

    expect(res.status).toBe(404);
    expect(await prisma.appointment.count()).toBe(1);
  });

  it.each(['admin', 'secretary'])('lets %s delete any appointment', async (role) => {
    const { appointment } = await setup();
    const staff = await createUser({ role });

    const res = await del(staff.token, appointment.id);

    expect(res.status).toBe(200);
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('returns 404 for an unknown appointment id', async () => {
    const { token } = await createUser();

    const res = await del(token, '00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
  });
});
