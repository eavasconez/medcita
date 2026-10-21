const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');
const { MONDAY, TUESDAY, clinicParts } = require('./helpers/time');
const { sendReminders } = require('../src/tasks/reminderTask');

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

  // Patient-facing messages are in Spanish and name the doctor as saved ("Dr." or
  // "Dra."), without an article in front that would be wrong for one of them.
  it.each(['Dr. Santiago Pérez', 'Dra. Camila Torres'])('names %s in the WhatsApp confirmation without an article', async (name) => {
    const { token } = await createUser({ name });

    await post(token, booking());

    const [message] = notifications.sent.filter((m) => m.channel === 'whatsapp');
    expect(message.message).toContain(`tu cita con ${name} ha sido agendada`);
  });

  it('sends the confirmation to the patient (WhatsApp + email) and a notice to the doctor', async () => {
    const { user, token } = await createUser({ name: 'Dr. House', email: 'house@example.test' });

    await post(token, booking({ patientEmail: 'maria@example.test' }));

    const whatsapp = notifications.sent.filter((m) => m.channel === 'whatsapp');
    expect(whatsapp).toHaveLength(1);
    expect(whatsapp[0].to).toBe('+593990000042');
    expect(whatsapp[0].message).toContain(`${TUESDAY} a las 10:00`);
    expect(whatsapp[0].message).toContain(user.name);
    expect(whatsapp[0].template).toMatchObject({ name: 'cita_confirmada', language: 'es' });
    expect(whatsapp[0].template.params).toEqual(['María Andrade', user.name, TUESDAY, '10:00']);

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
    const patient = await prisma.patient.findFirst({ where: { phone: '+593990000042' } });
    expect(patient).toMatchObject({ name: 'María A. Andrade', email: 'maria@example.test', cedula: '1712345678' });
    expect(await prisma.patient.count()).toBe(1);
  });

  describe('patient data that is already taken', () => {
    it('says which field belongs to another patient (cedula)', async () => {
      const { token } = await createUser();
      await createPatient({ phone: '+593991111111', cedula: '1700000001' });

      const res = await post(token, booking({ patientPhone: '+593992222222', patientCedula: '1700000001' }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('A patient with this cedula already exists');
    });
  });

  describe('schedule conflicts', () => {
    it('rejects a second appointment for the same doctor, date and time', async () => {
      const { token } = await createUser();
      await post(token, booking());

      const res = await post(token, booking({ patientName: 'Otro Paciente', patientPhone: '+593990000099' }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('An appointment already exists at this time');
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
      await prisma.availability.create({ data: { doctorId: user.id, clinicId: user.clinicId, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' } });

      const inside = await post(token, booking({ date: MONDAY, time: '10:00' }));
      const afterHours = await post(token, booking({ date: MONDAY, time: '15:00', patientPhone: '+593990000003' }));
      const otherDay = await post(token, booking({ date: TUESDAY, time: '10:00', patientPhone: '+593990000004' }));

      expect(inside.status).toBe(201);
      expect(afterHours.status).toBe(400);
      expect(afterHours.body.error).toBe('The doctor does not work at the selected time');
      expect(otherDay.status).toBe(400);
      expect(otherDay.body.error).toBe('The doctor does not work at the selected time');
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
  const list = (token, query = {}) => request(app).get('/api/appointments').query(query).set(bearer(token));

  it('lists only the appointments of the authenticated doctor, ordered by date and time', async () => {
    const a = await createUser();
    const b = await createUser();
    const patient = await createPatient({ name: 'Paciente Uno' });
    await createAppointment({ doctor: a.user, patient, date: TUESDAY, time: '11:00' });
    await createAppointment({ doctor: a.user, patient, date: MONDAY, time: '15:00' });
    await createAppointment({ doctor: a.user, patient, date: TUESDAY, time: '09:00' });
    await createAppointment({ doctor: b.user, patient, date: TUESDAY, time: '10:00' });

    const res = await list(a.token);

    expect(res.status).toBe(200);
    expect(res.body.appointments.map((x) => `${x.date} ${x.time}`)).toEqual([`${MONDAY} 15:00`, `${TUESDAY} 09:00`, `${TUESDAY} 11:00`]);
    expect(res.body.appointments[0].Patient.name).toBe('Paciente Uno');
    expect(res.body.appointments[0].doctor.name).toBe(a.user.name);
    expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 100, totalPages: 1 });
  });

  it('filters by date, status and patient', async () => {
    const { user, token } = await createUser();
    const p1 = await createPatient();
    const p2 = await createPatient();
    await createAppointment({ doctor: user, patient: p1, date: MONDAY, time: '09:00', status: 'confirmed' });
    await createAppointment({ doctor: user, patient: p1, date: TUESDAY, time: '09:00', status: 'pending_approval' });
    await createAppointment({ doctor: user, patient: p2, date: TUESDAY, time: '10:00', status: 'confirmed' });

    const byDate = await list(token, { date: TUESDAY });
    const byStatus = await list(token, { status: 'confirmed' });
    const byPatient = await list(token, { patientId: p2.id });

    expect(byDate.body.appointments).toHaveLength(2);
    expect(byStatus.body.appointments).toHaveLength(2);
    expect(byPatient.body.appointments).toHaveLength(1);
    expect(byPatient.body.appointments[0].patientId).toBe(p2.id);
  });

  it('leaves cancelled appointments out unless they are asked for with ?status=cancelled', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    await createAppointment({ doctor: user, patient, date: TUESDAY, time: '09:00', status: 'confirmed' });
    await createAppointment({ doctor: user, patient, date: TUESDAY, time: '10:00', status: 'cancelled' });

    const byDefault = await list(token);
    const cancelled = await list(token, { status: 'cancelled' });

    expect(byDefault.body.appointments.map((x) => x.time)).toEqual(['09:00']);
    expect(byDefault.body.total).toBe(1);
    expect(cancelled.body.appointments.map((x) => x.time)).toEqual(['10:00']);
  });

  it.each(['admin', 'secretary'])('lets %s see every doctor and filter by doctorId', async (role) => {
    const a = await createUser();
    const b = await createUser();
    const staff = await createUser({ role });
    const patient = await createPatient();
    await createAppointment({ doctor: a.user, patient, date: TUESDAY, time: '09:00' });
    await createAppointment({ doctor: b.user, patient, date: TUESDAY, time: '10:00' });

    const all = await list(staff.token);
    const onlyB = await list(staff.token, { doctorId: b.user.id });

    expect(all.body.appointments).toHaveLength(2);
    expect(onlyB.body.appointments).toHaveLength(1);
    expect(onlyB.body.appointments[0].doctorId).toBe(b.user.id);
  });

  it('does not let a regular doctor read another doctor with ?doctorId', async () => {
    const a = await createUser();
    const b = await createUser();
    const patient = await createPatient();
    await createAppointment({ doctor: b.user, patient, date: TUESDAY, time: '10:00' });

    const res = await list(a.token, { doctorId: b.user.id });

    expect(res.body.appointments).toEqual([]);
  });

  describe('paging', () => {
    const seed = async (count) => {
      const { user, token } = await createUser();
      const patient = await createPatient();
      for (let i = 0; i < count; i++) {
        const time = `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
        await createAppointment({ doctor: user, patient, date: TUESDAY, time });
      }
      return { user, token };
    };

    it('returns one page at a time with the paging info', async () => {
      const { token } = await seed(5);

      const first = await list(token, { pageSize: 2 });
      const second = await list(token, { pageSize: 2, page: 2 });
      const last = await list(token, { pageSize: 2, page: 3 });

      expect(first.body).toMatchObject({ total: 5, page: 1, pageSize: 2, totalPages: 3 });
      expect(first.body.appointments.map((x) => x.time)).toEqual(['08:00', '08:30']);
      expect(second.body.appointments.map((x) => x.time)).toEqual(['09:00', '09:30']);
      expect(last.body.appointments.map((x) => x.time)).toEqual(['10:00']);
    });

    it('never repeats or skips an appointment between pages, even with equal date and time', async () => {
      const staff = await createUser({ role: 'admin' });
      const patient = await createPatient();
      for (let i = 0; i < 6; i++) {
        const doctor = (await createUser()).user;
        await createAppointment({ doctor, patient, date: TUESDAY, time: '09:00' });
      }

      const ids = [];
      for (const page of [1, 2, 3]) {
        const res = await list(staff.token, { pageSize: 2, page });
        ids.push(...res.body.appointments.map((x) => x.id));
      }

      expect(new Set(ids).size).toBe(6);
    });

    it('defaults to 100 per page and caps pageSize at 500', async () => {
      const { token } = await createUser();

      const byDefault = await list(token);
      const huge = await list(token, { pageSize: 10000 });

      expect(byDefault.body.pageSize).toBe(100);
      expect(huge.body.pageSize).toBe(500);
      expect(byDefault.body).toMatchObject({ appointments: [], total: 0, totalPages: 1 });
    });

    it.each([
      [{ page: '0' }, /page must be a positive integer/],
      [{ page: 'abc' }, /page must be a positive integer/],
      [{ pageSize: '0' }, /pageSize must be a positive integer/],
      [{ pageSize: '2.5' }, /pageSize must be a positive integer/],
      [{ page: '5000000', pageSize: '500' }, /page is out of range/]
    ])('returns 400 for %j', async (query, message) => {
      const { token } = await createUser();

      const res = await list(token, query);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    });
  });

  describe('date range', () => {
    const setup = async () => {
      const { user, token } = await createUser();
      const patient = await createPatient();
      for (const date of ['2030-01-10', '2030-01-14', '2030-01-15', '2030-01-20']) {
        await createAppointment({ doctor: user, patient, date, time: '09:00' });
      }
      return { token };
    };

    it('includes both ends of ?from and ?to', async () => {
      const { token } = await setup();

      const res = await list(token, { from: '2030-01-14', to: '2030-01-15' });

      expect(res.body.appointments.map((x) => x.date)).toEqual(['2030-01-14', '2030-01-15']);
      expect(res.body.total).toBe(2);
    });

    it('accepts just one end', async () => {
      const { token } = await setup();

      const from = await list(token, { from: '2030-01-15' });
      const to = await list(token, { to: '2030-01-14' });

      expect(from.body.appointments.map((x) => x.date)).toEqual(['2030-01-15', '2030-01-20']);
      expect(to.body.appointments.map((x) => x.date)).toEqual(['2030-01-10', '2030-01-14']);
    });

    it('lets an exact ?date win over a range', async () => {
      const { token } = await setup();

      const res = await list(token, { date: '2030-01-20', from: '2030-01-01', to: '2030-01-14' });

      expect(res.body.appointments.map((x) => x.date)).toEqual(['2030-01-20']);
    });

    it.each([
      [{ from: '2030/01/14' }, /from must be a valid date/],
      [{ from: '2030-02-31' }, /from must be a valid date/],
      [{ to: 'tomorrow' }, /to must be a valid date/],
      [{ from: '2030-01-15', to: '2030-01-14' }, /from must not be after to/]
    ])('returns 400 for %j', async (query, message) => {
      const { token } = await createUser();

      const res = await list(token, query);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    });
  });
});

describe('GET /api/appointments/stats', () => {
  const stats = (token, query = {}) => request(app).get('/api/appointments/stats').query(query).set(bearer(token));

  it('counts the appointments, the confirmed or completed ones and the distinct patients', async () => {
    const { user, token } = await createUser();
    const p1 = await createPatient();
    const p2 = await createPatient();
    await createAppointment({ doctor: user, patient: p1, date: MONDAY, time: '09:00', status: 'confirmed' });
    await createAppointment({ doctor: user, patient: p1, date: TUESDAY, time: '09:00', status: 'completed' });
    await createAppointment({ doctor: user, patient: p2, date: TUESDAY, time: '10:00', status: 'pending_approval' });
    await createAppointment({ doctor: user, patient: p2, date: TUESDAY, time: '11:00', status: 'scheduled' });

    const res = await stats(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 4, positive: 2, cancelled: 0, noShow: 0, patients: 2 });
  });

  it('keeps cancelled appointments out of the totals and counts them apart', async () => {
    const { user, token } = await createUser();
    const p1 = await createPatient();
    const p2 = await createPatient();
    await createAppointment({ doctor: user, patient: p1, date: MONDAY, time: '09:00', status: 'confirmed' });
    await createAppointment({ doctor: user, patient: p2, date: TUESDAY, time: '09:00', status: 'cancelled' });
    await createAppointment({ doctor: user, patient: p2, date: TUESDAY, time: '10:00', status: 'cancelled' });

    const res = await stats(token);

    expect(res.body).toEqual({ total: 1, positive: 1, cancelled: 2, noShow: 0, patients: 1 });
  });

  it('is all zeros for a doctor without appointments', async () => {
    const { token } = await createUser();

    const res = await stats(token);

    expect(res.body).toEqual({ total: 0, positive: 0, cancelled: 0, noShow: 0, patients: 0 });
  });

  it('only counts the caller\'s own appointments, but lets admin and secretary pick a doctor', async () => {
    const a = await createUser();
    const b = await createUser();
    const staff = await createUser({ role: 'secretary' });
    const patient = await createPatient();
    await createAppointment({ doctor: a.user, patient, date: TUESDAY, time: '09:00', status: 'confirmed' });
    await createAppointment({ doctor: b.user, patient, date: TUESDAY, time: '10:00' });
    await createAppointment({ doctor: b.user, patient, date: TUESDAY, time: '11:00' });

    const own = await stats(a.token, { doctorId: b.user.id });
    const picked = await stats(staff.token, { doctorId: b.user.id });
    const clinic = await stats(staff.token);

    expect(own.body.total).toBe(1);
    expect(picked.body.total).toBe(2);
    expect(clinic.body.total).toBe(3);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/appointments/stats');

    expect(res.status).toBe(401);
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

  it.each(['scheduled', 'pending_approval', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled'])('accepts status %s', async (status) => {
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

  describe('schedule rules when the appointment is moved', () => {
    const OCCUPIED = 'An appointment already exists at this time';
    const NOT_WORKING = 'The doctor does not work at the selected time';

    // The appointment from setup() (Tuesday 10:00) plus a second one of the
    // same doctor on Tuesday 11:00.
    const setupWithNeighbour = async () => {
      const base = await setup();
      const neighbour = await createAppointment({
        doctor: base.owner.user, patient: base.patient, date: TUESDAY, time: '11:00'
      });
      return { ...base, neighbour };
    };
    const reload = (id) => prisma.appointment.findUnique({ where: { id } });

    it('rejects a move onto a slot the same doctor already holds, and leaves the appointment where it was', async () => {
      const { owner, appointment } = await setupWithNeighbour();

      const res = await put(owner.token, appointment.id, { date: TUESDAY, time: '11:00' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe(OCCUPIED);
      expect(await reload(appointment.id)).toMatchObject({ date: TUESDAY, time: '10:00' });
    });

    it('rejects changing only the time, or only the date, into a held slot', async () => {
      const { owner, appointment, patient } = await setupWithNeighbour();
      await createAppointment({ doctor: owner.user, patient, date: MONDAY, time: '10:00' });

      const onlyTime = await put(owner.token, appointment.id, { time: '11:00' });
      const onlyDate = await put(owner.token, appointment.id, { date: MONDAY });

      expect(onlyTime.status).toBe(409);
      expect(onlyDate.status).toBe(409);
    });

    it('allows a move into a slot freed by a cancelled appointment', async () => {
      const { owner, appointment, neighbour } = await setupWithNeighbour();
      await prisma.appointment.update({ where: { id: neighbour.id }, data: { status: 'cancelled' } });

      const res = await put(owner.token, appointment.id, { time: '11:00' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ date: TUESDAY, time: '11:00' });
    });

    it('does not clash with the appointment itself when it is sent back to its own slot', async () => {
      const { owner, appointment } = await setupWithNeighbour();

      const res = await put(owner.token, appointment.id, { date: TUESDAY, time: '10:00', notes: 'Sin cambios de horario' });

      expect(res.status).toBe(200);
    });

    it('allows the slot another doctor holds', async () => {
      const { owner, appointment, patient } = await setup();
      const other = await createUser();
      await createAppointment({ doctor: other.user, patient, date: TUESDAY, time: '11:00' });

      const res = await put(owner.token, appointment.id, { time: '11:00' });

      expect(res.status).toBe(200);
    });

    it("checks an admin's or secretary's move against the appointment's doctor, not the caller", async () => {
      const { appointment } = await setupWithNeighbour();
      const staff = await createUser({ role: 'admin' });

      const taken = await put(staff.token, appointment.id, { time: '11:00' });
      const free = await put(staff.token, appointment.id, { time: '12:00' });

      expect(taken.status).toBe(409);
      expect(free.status).toBe(200);
    });

    it('rejects a move outside the days and hours the doctor works', async () => {
      const { owner, appointment } = await setup();
      await prisma.availability.create({ data: { doctorId: owner.user.id, clinicId: owner.user.clinicId, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' } });
      await prisma.appointment.update({ where: { id: appointment.id }, data: { date: MONDAY, time: '10:00' } });

      const afterHours = await put(owner.token, appointment.id, { time: '15:00' });
      const otherDay = await put(owner.token, appointment.id, { date: TUESDAY });
      const inside = await put(owner.token, appointment.id, { time: '11:30' });

      expect(afterHours.status).toBe(400);
      expect(afterHours.body.error).toBe(NOT_WORKING);
      expect(otherDay.status).toBe(400);
      expect(otherDay.body.error).toBe(NOT_WORKING);
      expect(inside.status).toBe(200);
      expect(await reload(appointment.id)).toMatchObject({ date: MONDAY, time: '11:30' });
    });

    it('does not restrict a doctor who has not configured any schedule', async () => {
      const { owner, appointment } = await setup();

      const res = await put(owner.token, appointment.id, { date: MONDAY, time: '23:30' });

      expect(res.status).toBe(200);
    });

    it('rejects a move to a time that has already passed, but accepts one still ahead', async () => {
      const { owner, appointment } = await setup();
      const past = clinicParts(-2);
      const ahead = clinicParts(2);

      const toThePast = await put(owner.token, appointment.id, past);
      const toTheFuture = await put(owner.token, appointment.id, ahead);

      expect(toThePast.status).toBe(400);
      expect(toThePast.body.error).toBe('The appointment cannot be moved to a time that has already passed');
      expect(toTheFuture.status).toBe(200);
      expect(await reload(appointment.id)).toMatchObject(ahead);
    });

    it('still lets a past appointment be updated without moving it', async () => {
      const owner = await createUser();
      const patient = await createPatient();
      const past = clinicParts(-48);
      const appointment = await createAppointment({ doctor: owner.user, patient, ...past });

      const res = await put(owner.token, appointment.id, { status: 'completed', notes: 'Atendido' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
    });

    it('lets the date of an appointment already marked as completed be corrected into the past', async () => {
      const { owner, appointment } = await setup();
      const past = clinicParts(-72);

      const res = await put(owner.token, appointment.id, { status: 'completed', ...past });

      expect(res.status).toBe(200);
      expect(await reload(appointment.id)).toMatchObject(past);
    });

    it('does not re-check the schedule when only the status or notes change', async () => {
      const { owner, appointment } = await setup();
      // The doctor's schedule changed after this appointment was booked.
      await prisma.availability.create({ data: { doctorId: owner.user.id, clinicId: owner.user.clinicId, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' } });

      const res = await put(owner.token, appointment.id, { status: 'confirmed', notes: 'Confirmada por teléfono' });

      expect(res.status).toBe(200);
    });

    describe('bringing a cancelled appointment back', () => {
      it('is rejected, with 409, while someone else holds its slot', async () => {
        const { owner, appointment, patient } = await setup();
        await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'cancelled' } });
        await createAppointment({ doctor: owner.user, patient, date: TUESDAY, time: '10:00' });

        const res = await put(owner.token, appointment.id, { status: 'confirmed' });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe(OCCUPIED);
        expect((await reload(appointment.id)).status).toBe('cancelled');
      });

      it('works when the slot is still free', async () => {
        const { owner, appointment } = await setup();
        await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'cancelled' } });

        const res = await put(owner.token, appointment.id, { status: 'scheduled' });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('scheduled');
      });

      it('is checked together with a move to a new slot', async () => {
        const { owner, appointment, neighbour } = await setupWithNeighbour();
        await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'cancelled' } });

        const taken = await put(owner.token, appointment.id, { status: 'confirmed', time: '11:00' });
        const free = await put(owner.token, appointment.id, { status: 'confirmed', time: '12:00' });

        expect(neighbour.time).toBe('11:00');
        expect(taken.status).toBe(409);
        expect(free.status).toBe(200);
      });

      it('does not require the slot to be free when the appointment stays cancelled', async () => {
        const { owner, appointment } = await setupWithNeighbour();
        await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'cancelled' } });

        const res = await put(owner.token, appointment.id, { time: '11:00' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'cancelled', time: '11:00' });
      });
    });

    it('cancelling while moving does not run the slot checks', async () => {
      const { owner, appointment } = await setupWithNeighbour();

      const res = await put(owner.token, appointment.id, { status: 'cancelled', time: '11:00' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
    });

    it('lets exactly one of two appointments take the same free slot at the same time', async () => {
      const { owner, appointment, neighbour } = await setupWithNeighbour();

      const responses = await Promise.all([
        put(owner.token, appointment.id, { time: '14:00' }),
        put(owner.token, neighbour.id, { date: TUESDAY, time: '14:00' })
      ]);

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s !== 200).every((s) => s === 409)).toBe(true);
      expect(await prisma.appointment.count({ where: { date: TUESDAY, time: '14:00' } })).toBe(1);
    });
  });
});

describe('DELETE /api/appointments/:id (cancels the appointment)', () => {
  const setup = async () => {
    const owner = await createUser();
    const patient = await createPatient();
    const appointment = await createAppointment({ doctor: owner.user, patient, date: TUESDAY, time: '10:00' });
    return { owner, patient, appointment };
  };
  const del = (token, id) => request(app).delete(`/api/appointments/${id}`).set(bearer(token));
  const statusOf = async (appointment) => (await prisma.appointment.findUnique({ where: { id: appointment.id } })).status;

  it('lets a doctor cancel their own appointment, and keeps it', async () => {
    const { owner, appointment } = await setup();

    const res = await del(owner.token, appointment.id);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Appointment cancelled successfully');
    expect(res.body.appointment).toMatchObject({ id: appointment.id, status: 'cancelled' });
    expect(res.body.appointment.Patient).toBeDefined();
    expect(await prisma.appointment.count()).toBe(1);
    expect(await statusOf(appointment)).toBe('cancelled');
  });

  it('can be repeated: cancelling a cancelled appointment gives the same answer', async () => {
    const { owner, appointment } = await setup();

    await del(owner.token, appointment.id);
    const again = await del(owner.token, appointment.id);

    expect(again.status).toBe(200);
    expect(await statusOf(appointment)).toBe('cancelled');
  });

  it('frees the slot so it can be booked again', async () => {
    const { owner, appointment } = await setup();
    await del(owner.token, appointment.id);

    const res = await post(owner.token, booking({ time: '10:00', patientPhone: '+593990000077' }));

    expect(res.status).toBe(201);
  });

  it("does not let a doctor cancel another doctor's appointment", async () => {
    const { appointment } = await setup();
    const intruder = await createUser();

    const res = await del(intruder.token, appointment.id);

    expect(res.status).toBe(404);
    expect(await statusOf(appointment)).toBe('pending_approval');
  });

  it.each(['admin', 'secretary'])('lets %s cancel any appointment', async (role) => {
    const { appointment } = await setup();
    const staff = await createUser({ role });

    const res = await del(staff.token, appointment.id);

    expect(res.status).toBe(200);
    expect(await statusOf(appointment)).toBe('cancelled');
  });

  it('returns 404 for an unknown appointment id', async () => {
    const { token } = await createUser();

    const res = await del(token, '00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
  });

  it('is not counted in the appointment totals of the patient or the doctor', async () => {
    const { owner, patient, appointment } = await setup();
    await createAppointment({ doctor: owner.user, patient, date: TUESDAY, time: '11:00' });
    const staff = await createUser({ role: 'admin' });

    await del(owner.token, appointment.id);
    const patients = await request(app).get('/api/patients').set(bearer(owner.token));
    const doctors = await request(app).get('/api/admin/doctors').query({ role: 'doctor' }).set(bearer(staff.token));
    const report = await request(app).get('/api/admin/reports/appointments-by-doctor').set(bearer(staff.token));

    expect(patients.body.patients[0]._count.appointments).toBe(1);
    expect(doctors.body.find((d) => d.id === owner.user.id)._count.appointments).toBe(1);
    expect(report.body.find((r) => r.doctor === owner.user.name).appointments).toBe(1);
  });

  it('does not get reminded', async () => {
    const { owner, patient } = await setup();
    const soon = await createAppointment({ doctor: owner.user, patient, ...clinicParts(3), status: 'confirmed' });

    await del(owner.token, soon.id);
    await sendReminders();

    expect(notifications.sent).toHaveLength(0);
  });
});
