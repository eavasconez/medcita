const request = require('supertest');
const app = require('../src/server');
const { sendReminders } = require('../src/tasks/reminderTask');
const { prisma, resetDb } = require('./helpers/db');
const {
  createClinic,
  createUser,
  createPatient,
  createAppointment,
  createAvailability,
  bearer
} = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');
const { MONDAY, TUESDAY, clinicParts } = require('./helpers/time');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});

afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

// Two complete clinics. Everything a test does as clinic B must leave clinic A
// exactly as it was, and must never show A's data to B.
async function twoClinics() {
  const world = {};
  for (const key of ['a', 'b']) {
    const clinic = await createClinic({ name: `Clínica ${key.toUpperCase()}`, slug: `clinica-${key}` });
    const admin = await createUser({ role: 'admin', clinic, name: `Admin ${key}` });
    const secretary = await createUser({ role: 'secretary', clinic, name: `Secretaria ${key}` });
    const doctor = await createUser({ clinic, name: `Dr ${key}` });
    const patient = await createPatient({ clinic, name: `Paciente de ${key}`, phone: `+5939${key === 'a' ? '1' : '2'}0000000`, cedula: `${key === 'a' ? '1' : '2'}700000000` });
    const appointment = await createAppointment({ doctor: doctor.user, patient, date: MONDAY, time: '09:00', status: 'confirmed' });
    world[key] = { clinic, admin, secretary, doctor, patient, appointment };
  }
  return world;
}

const get = (token, url) => request(app).get(url).set(bearer(token));
const send = (method, token, url, body) => request(app)[method](url).set(bearer(token)).send(body);

describe('patients', () => {
  it('lists only the patients of the caller\'s clinic, whoever asks', async () => {
    const { a, b } = await twoClinics();

    for (const who of [b.admin, b.secretary, b.doctor]) {
      const res = await get(who.token, '/api/patients');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.patients.map((p) => p.id)).toEqual([b.patient.id]);
    }
    expect((await get(a.admin.token, '/api/patients')).body.patients.map((p) => p.id)).toEqual([a.patient.id]);
  });

  it('does not find a patient of another clinic by name, phone or cedula', async () => {
    const { a, b } = await twoClinics();

    for (const search of [a.patient.name, a.patient.phone, a.patient.cedula]) {
      const res = await get(b.admin.token, `/api/patients?search=${encodeURIComponent(search)}`);
      expect(res.body.patients).toEqual([]);
      expect(res.body.total).toBe(0);
    }
  });

  it('answers 404 to edit or delete a patient of another clinic, and leaves it untouched', async () => {
    const { a, b } = await twoClinics();
    const lonePatient = await createPatient({ clinic: a.clinic, name: 'Sin citas' });

    const put = await send('put', b.admin.token, `/api/patients/${a.patient.id}`, { name: 'Cambiado' });
    const del = await send('delete', b.admin.token, `/api/patients/${lonePatient.id}`);

    expect(put.status).toBe(404);
    expect(del.status).toBe(404);
    expect((await prisma.patient.findUnique({ where: { id: a.patient.id } })).name).toBe(a.patient.name);
    expect(await prisma.patient.findUnique({ where: { id: lonePatient.id } })).not.toBeNull();
  });

  it('lets two clinics have a patient with the same phone and cedula, as two different patients', async () => {
    const { a, b } = await twoClinics();

    const res = await send('post', b.admin.token, '/api/patients', {
      name: 'Otra persona',
      phone: a.patient.phone,
      cedula: a.patient.cedula
    });

    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(a.patient.id);
    expect(res.body.clinicId).toBe(b.clinic.id);
    const original = await prisma.patient.findUnique({ where: { id: a.patient.id } });
    expect(original).toMatchObject({ name: a.patient.name, clinicId: a.clinic.id });
  });

  it('still refuses a repeated cedula inside the same clinic', async () => {
    const { b } = await twoClinics();
    const res = await send('post', b.admin.token, '/api/patients', { name: 'Doble', phone: '+593988888888', cedula: b.patient.cedula });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A patient with this cedula already exists');
  });

  it('files a new patient in the caller\'s clinic even if the request names another one', async () => {
    const { a, b } = await twoClinics();

    const res = await send('post', b.admin.token, '/api/patients', {
      name: 'Intruso',
      phone: '+593977777777',
      clinicId: a.clinic.id
    });

    expect(res.status).toBe(201);
    expect(res.body.clinicId).toBe(b.clinic.id);
  });
});

describe('appointments', () => {
  it('lists only the appointments of the caller\'s clinic, for every role', async () => {
    const { a, b } = await twoClinics();

    for (const who of [b.admin, b.secretary]) {
      const res = await get(who.token, '/api/appointments');
      expect(res.body.appointments.map((x) => x.id)).toEqual([b.appointment.id]);
      expect(res.body.total).toBe(1);
    }
    expect((await get(b.doctor.token, '/api/appointments')).body.appointments.map((x) => x.id)).toEqual([b.appointment.id]);
    expect((await get(a.admin.token, '/api/appointments')).body.appointments.map((x) => x.id)).toEqual([a.appointment.id]);
  });

  it('shows nothing when filtering by a doctor, a patient or a date range of another clinic', async () => {
    const { a, b } = await twoClinics();

    for (const query of [`doctorId=${a.doctor.user.id}`, `patientId=${a.patient.id}`, `date=${MONDAY}&doctorId=${a.doctor.user.id}`]) {
      const res = await get(b.admin.token, `/api/appointments?${query}`);
      expect(res.status).toBe(200);
      expect(res.body.appointments).toEqual([]);
    }
  });

  it('counts only the clinic\'s own appointments in the dashboard stats', async () => {
    const { a, b } = await twoClinics();
    await createAppointment({ doctor: a.doctor.user, patient: a.patient, date: TUESDAY, time: '10:00', status: 'cancelled' });

    const res = await get(b.admin.token, '/api/appointments/stats');

    expect(res.body).toEqual({ total: 1, positive: 1, cancelled: 0, noShow: 0, patients: 1 });
  });

  it('answers 404 to update or cancel an appointment of another clinic, and leaves it untouched', async () => {
    const { a, b } = await twoClinics();

    const put = await send('put', b.admin.token, `/api/appointments/${a.appointment.id}`, { status: 'cancelled' });
    const del = await send('delete', b.secretary.token, `/api/appointments/${a.appointment.id}`);

    expect(put.status).toBe(404);
    expect(del.status).toBe(404);
    expect((await prisma.appointment.findUnique({ where: { id: a.appointment.id } })).status).toBe('confirmed');
  });

  it('cannot book an agenda of another clinic, and creates nothing', async () => {
    const { a, b } = await twoClinics();

    const res = await send('post', b.admin.token, '/api/appointments', {
      patientName: 'Nadie',
      patientPhone: '+593966666666',
      date: TUESDAY,
      time: '10:00',
      doctorId: a.doctor.user.id
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Doctor not found');
    expect(await prisma.appointment.count({ where: { doctorId: a.doctor.user.id } })).toBe(1);
    expect(await prisma.patient.count({ where: { phone: '+593966666666' } })).toBe(0);
  });

  it('books a patient with the same phone as another clinic\'s patient without touching that one', async () => {
    const { a, b } = await twoClinics();

    const res = await send('post', b.doctor.token, '/api/appointments', {
      patientName: 'Homónimo',
      patientPhone: a.patient.phone,
      patientCedula: a.patient.cedula,
      date: TUESDAY,
      time: '10:00'
    });

    expect(res.status).toBe(201);
    expect(res.body.clinicId).toBe(b.clinic.id);
    expect(res.body.patient.id).not.toBe(a.patient.id);
    expect(await prisma.patient.findUnique({ where: { id: a.patient.id } })).toMatchObject({ name: a.patient.name });
  });

  it('ignores a clinicId sent in the body', async () => {
    const { a, b } = await twoClinics();

    const res = await send('post', b.doctor.token, '/api/appointments', {
      patientName: 'Intruso',
      patientPhone: '+593955555555',
      date: TUESDAY,
      time: '10:00',
      clinicId: a.clinic.id
    });

    expect(res.status).toBe(201);
    expect(res.body.clinicId).toBe(b.clinic.id);
  });
});

describe('availability', () => {
  it('answers 404 to read the schedule or the slots of a doctor of another clinic', async () => {
    const { a, b } = await twoClinics();
    await createAvailability({ doctor: a.doctor.user, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' });

    const schedule = await get(b.admin.token, `/api/availability?doctorId=${a.doctor.user.id}`);
    const slots = await get(b.admin.token, `/api/availability/slots?date=${MONDAY}&doctorId=${a.doctor.user.id}`);

    expect(schedule.status).toBe(404);
    expect(slots.status).toBe(404);
  });

  it('answers 404 to change the schedule of a doctor of another clinic, and keeps it as it was', async () => {
    const { a, b } = await twoClinics();
    await createAvailability({ doctor: a.doctor.user, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' });

    const res = await send('post', b.admin.token, '/api/availability', {
      doctorId: a.doctor.user.id,
      schedules: [{ dayOfWeek: 2, startTime: '08:00', endTime: '10:00' }]
    });

    expect(res.status).toBe(404);
    const stored = await prisma.availability.findMany({ where: { doctorId: a.doctor.user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ dayOfWeek: 1, startTime: '09:00' });
  });

  it('stores a schedule in the clinic of its doctor', async () => {
    const { b } = await twoClinics();

    const res = await send('post', b.admin.token, '/api/availability', {
      doctorId: b.doctor.user.id,
      schedules: [{ dayOfWeek: 2, startTime: '08:00', endTime: '10:00' }]
    });

    expect(res.status).toBe(200);
    const stored = await prisma.availability.findMany({ where: { doctorId: b.doctor.user.id } });
    expect(stored.map((row) => row.clinicId)).toEqual([b.clinic.id]);
  });

  it('answers 404 for a doctor id that does not exist, like for one of another clinic', async () => {
    const { b } = await twoClinics();
    const res = await get(b.admin.token, '/api/availability?doctorId=no-such-doctor');
    expect(res.status).toBe(404);
  });
});

describe('admin', () => {
  it('lists, and reports on, only the doctors of the clinic', async () => {
    const { b } = await twoClinics();

    const list = await get(b.admin.token, '/api/admin/doctors');
    const report = await get(b.admin.token, '/api/admin/reports/appointments-by-doctor');

    expect(list.body.map((d) => d.id).sort()).toEqual([b.admin.user.id, b.secretary.user.id, b.doctor.user.id].sort());
    expect(report.body).toEqual([{ doctor: 'Dr b', appointments: 1 }]);
  });

  it('invites new accounts into the admin\'s own clinic', async () => {
    const { b } = await twoClinics();

    const res = await send('post', b.admin.token, '/api/admin/doctors', {
      name: 'Dra. Nueva',
      email: 'nueva@example.test',
      role: 'secretary'
    });

    expect(res.status).toBe(201);
    expect((await prisma.invitation.findUnique({ where: { id: res.body.id } })).clinicId).toBe(b.clinic.id);
  });

  it('answers 404 to edit or delete an account of another clinic, and leaves it untouched', async () => {
    const { a, b } = await twoClinics();

    const put = await send('put', b.admin.token, `/api/admin/doctors/${a.doctor.user.id}`, { name: 'Cambiado', role: 'admin' });
    const del = await send('delete', b.admin.token, `/api/admin/doctors/${a.doctor.user.id}`);

    expect(put.status).toBe(404);
    expect(del.status).toBe(404);
    const stored = await prisma.doctor.findUnique({ where: { id: a.doctor.user.id } });
    expect(stored).toMatchObject({ name: a.doctor.user.name, role: 'doctor', password: a.doctor.user.password });
  });

  it('does not let a clinic admin create a platform admin', async () => {
    const { b } = await twoClinics();

    const res = await send('post', b.admin.token, '/api/admin/doctors', {
      name: 'Super',
      email: 'super@example.test',
      role: 'superadmin'
    });

    expect(res.status).toBe(400);
    expect(await prisma.doctor.count({ where: { role: 'superadmin' } })).toBe(0);
  });

  it('shows in the audit log only what happened in the clinic', async () => {
    const { a, b } = await twoClinics();
    await send('put', a.admin.token, `/api/appointments/${a.appointment.id}`, { status: 'completed' });
    await send('put', b.admin.token, `/api/appointments/${b.appointment.id}`, { status: 'cancelled' });

    const forB = await get(b.admin.token, '/api/admin/audit-log');
    const forA = await get(a.admin.token, '/api/admin/audit-log');

    expect(forB.body.entries.map((e) => e.entityId)).toEqual([b.appointment.id]);
    expect(forA.body.entries.map((e) => e.entityId)).toEqual([a.appointment.id]);
    expect((await prisma.auditLog.findMany()).map((row) => row.clinicId).sort()).toEqual([a.clinic.id, b.clinic.id].sort());
  });
});

describe('reminders', () => {
  it('sends the reminders of the caller\'s clinic only when an admin triggers them by hand', async () => {
    const { a, b } = await twoClinics();
    await prisma.appointment.deleteMany();
    const soon = clinicParts(3);
    await createAppointment({ doctor: a.doctor.user, patient: a.patient, ...soon });
    await createAppointment({ doctor: b.doctor.user, patient: b.patient, ...soon });

    const res = await request(app).post('/api/tasks/reminders').set(bearer(b.admin.token));

    expect(res.status).toBe(200);
    const whatsapp = notifications.sent.filter((m) => m.channel === 'whatsapp').map((m) => m.to);
    expect(whatsapp).toEqual([b.patient.phone]);
    expect((await prisma.appointment.findMany({ where: { clinicId: a.clinic.id } }))[0].reminderSentAt).toBeNull();
  });

  it('sends the reminders of every clinic when the scheduled task runs', async () => {
    const { a, b } = await twoClinics();
    await prisma.appointment.deleteMany();
    const soon = clinicParts(3);
    await createAppointment({ doctor: a.doctor.user, patient: a.patient, ...soon });
    await createAppointment({ doctor: b.doctor.user, patient: b.patient, ...soon });

    await sendReminders();

    const whatsapp = notifications.sent.filter((m) => m.channel === 'whatsapp').map((m) => m.to).sort();
    expect(whatsapp).toEqual([a.patient.phone, b.patient.phone].sort());
  });
});

describe('platform admin', () => {
  it('lists the clinics with their sizes, and nothing else', async () => {
    const { a, b } = await twoClinics();
    const platform = await createUser({ role: 'superadmin', clinic: await createClinic({ name: 'Plataforma', slug: 'plataforma' }) });

    const res = await get(platform.token, '/api/platform/clinics');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const byName = Object.fromEntries(res.body.clinics.map((c) => [c.name, c]));
    expect(byName['Clínica A']._count).toEqual({ doctors: 3, patients: 1, appointments: 1 });
    expect(byName['Clínica B'].slug).toBe(b.clinic.slug);
    expect(JSON.stringify(res.body)).not.toContain(a.patient.name);
  });

  it('is closed to everyone who is not a platform admin', async () => {
    const { a } = await twoClinics();

    for (const who of [a.admin, a.secretary, a.doctor]) {
      const res = await get(who.token, '/api/platform/clinics');
      expect(res.status).toBe(403);
    }
    expect((await request(app).get('/api/platform/clinics')).status).toBe(401);
  });

  it('does not give a platform admin the patients of the clinics: the clinic routes stay scoped', async () => {
    const { a } = await twoClinics();
    const platform = await createUser({ role: 'superadmin', clinic: await createClinic({ name: 'Plataforma', slug: 'plataforma' }) });

    expect((await get(platform.token, '/api/patients')).body.patients).toEqual([]);
    expect((await get(platform.token, '/api/appointments')).body.appointments).toEqual([]);
    expect((await get(platform.token, `/api/availability?doctorId=${a.doctor.user.id}`)).status).toBe(404);
  });
});

// The application filters every query by clinic; the database refuses the mixed
// links as well, so a bug in a future route cannot create them silently.
describe('database constraints', () => {
  const book = (data) => prisma.appointment.create({ data: { date: MONDAY, time: '11:00', status: 'pending_approval', ...data } });

  it('refuses an appointment whose doctor or patient belongs to another clinic', async () => {
    const { a, b } = await twoClinics();

    await expect(book({ clinicId: b.clinic.id, doctorId: a.doctor.user.id, patientId: b.patient.id })).rejects.toMatchObject({ code: 'P2003' });
    await expect(book({ clinicId: b.clinic.id, doctorId: b.doctor.user.id, patientId: a.patient.id })).rejects.toMatchObject({ code: 'P2003' });
    await expect(book({ clinicId: a.clinic.id, doctorId: a.doctor.user.id, patientId: a.patient.id })).resolves.toMatchObject({ clinicId: a.clinic.id });
  });

  it('refuses a schedule whose doctor belongs to another clinic', async () => {
    const { a, b } = await twoClinics();

    await expect(
      prisma.availability.create({ data: { doctorId: a.doctor.user.id, clinicId: b.clinic.id, dayOfWeek: 1, startTime: '08:00', endTime: '09:00' } })
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('refuses a record without a clinic', async () => {
    await expect(prisma.patient.create({ data: { name: 'Sin consultorio', phone: '+593900000099' } })).rejects.toThrow();
  });
});
