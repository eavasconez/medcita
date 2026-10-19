const request = require('supertest');
const app = require('../src/server');
const { sendReminders } = require('../src/tasks/reminderTask');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');
const { clinicParts } = require('./helpers/time');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});

afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

// A doctor with `count` patients, each with an appointment `hoursFromNow` ahead.
async function setup({ hoursFromNow, status = 'confirmed', patient: patientData = {}, ...rest } = {}) {
  const { user } = await createUser({ name: 'Dr. Santiago Pérez' });
  const patient = await createPatient(patientData);
  const appointment = await createAppointment({ doctor: user, patient, status, ...clinicParts(hoursFromNow), ...rest });
  return { doctor: user, patient, appointment };
}

const reload = (appointment) => prisma.appointment.findUnique({ where: { id: appointment.id } });
const sentTo = (to) => notifications.sent.filter((m) => m.to === to);

describe('sendReminders', () => {
  it.each(['pending_approval', 'scheduled', 'confirmed'])(
    'reminds a %s appointment that is within 24 hours, without changing its status',
    async (status) => {
      const { patient, appointment } = await setup({ hoursFromNow: 3, status, patient: { email: 'paciente@example.test' } });

      await sendReminders();

      expect(sentTo(patient.phone)).toHaveLength(1);
      expect(sentTo('paciente@example.test')).toHaveLength(1);
      const stored = await reload(appointment);
      expect(stored.reminderSentAt).toBeInstanceOf(Date);
      expect(stored.status).toBe(status);
    }
  );

  it('sends the reminder text with the patient, doctor, date and time', async () => {
    const { patient, appointment } = await setup({ hoursFromNow: 3 });

    await sendReminders();

    const [message] = sentTo(patient.phone);
    expect(message.message).toContain('Recordatorio MedCita');
    expect(message.message).toContain(patient.name);
    expect(message.message).toContain('Dr. Santiago Pérez');
    expect(message.message).toContain(`${appointment.date} a las ${appointment.time}`);
  });

  // Meta only accepts a business-started message as an approved template.
  it('hands the WhatsApp provider the reminder template with its values', async () => {
    const { patient, appointment } = await setup({ hoursFromNow: 3 });

    await sendReminders();

    const [message] = sentTo(patient.phone);
    expect(message.template).toMatchObject({ name: 'recordatorio_cita', language: 'es' });
    expect(message.template.params).toEqual([patient.name, expect.stringMatching(new RegExp(`^(hoy|mañana) ${appointment.date}$`)), appointment.time, 'Dr. Santiago Pérez']);
  });

  it.each(['cancelled', 'completed'])('does not remind a %s appointment', async (status) => {
    const { patient, appointment } = await setup({ hoursFromNow: 3, status });

    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(0);
    expect((await reload(appointment)).reminderSentAt).toBeNull();
  });

  it('does not remind appointments more than 24 hours away', async () => {
    const { patient, appointment } = await setup({ hoursFromNow: 30 });

    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(0);
    expect((await reload(appointment)).reminderSentAt).toBeNull();
  });

  it('does not remind appointments that already took place', async () => {
    const { patient } = await setup({ hoursFromNow: -1 });

    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(0);
  });

  it('reminds each appointment only once across runs', async () => {
    const { patient } = await setup({ hoursFromNow: 3 });

    await sendReminders();
    await sendReminders();
    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(1);
  });

  it('skips an appointment that was already reminded', async () => {
    const { patient } = await setup({ hoursFromNow: 3, reminderSentAt: new Date() });

    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(0);
  });

  it('sends a single reminder when two runs overlap', async () => {
    const { patient } = await setup({ hoursFromNow: 3, patient: { email: 'paciente@example.test' } });

    await Promise.all([sendReminders(), sendReminders()]);

    expect(sentTo(patient.phone)).toHaveLength(1);
    expect(sentTo('paciente@example.test')).toHaveLength(1);
  });

  it('releases the appointment for a retry when no channel delivers', async () => {
    const { patient, appointment } = await setup({ hoursFromNow: 3 });
    notifications.failPhones.add(patient.phone);

    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(0);
    expect((await reload(appointment)).reminderSentAt).toBeNull();

    // The provider recovers: the next run delivers it.
    notifications.failPhones.clear();
    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(1);
    expect((await reload(appointment)).reminderSentAt).toBeInstanceOf(Date);
  });

  it('counts the reminder as delivered when only the email channel works', async () => {
    const { patient, appointment } = await setup({ hoursFromNow: 3, patient: { email: 'paciente@example.test' } });
    notifications.failPhones.add(patient.phone);

    await sendReminders();

    expect(sentTo('paciente@example.test')).toHaveLength(1);
    expect((await reload(appointment)).reminderSentAt).toBeInstanceOf(Date);
  });

  it('keeps going with the remaining appointments when one cannot be delivered', async () => {
    const doctor = (await createUser()).user;
    const failing = await createPatient();
    const working = await createPatient();
    await createAppointment({ doctor, patient: failing, status: 'confirmed', ...clinicParts(2) });
    await createAppointment({ doctor, patient: working, status: 'confirmed', ...clinicParts(4) });
    notifications.failPhones.add(failing.phone);

    await sendReminders();

    expect(sentTo(failing.phone)).toHaveLength(0);
    expect(sentTo(working.phone)).toHaveLength(1);
  });

  it('says "hoy" or "mañana" according to the appointment date, in WhatsApp and email', async () => {
    const today = clinicParts(0).date;
    const first = await setup({ hoursFromNow: 2, patient: { email: 'a@example.test' } });
    const second = await setup({ hoursFromNow: 23, patient: { email: 'b@example.test' } });

    await sendReminders();

    for (const { patient, appointment } of [first, second]) {
      const label = appointment.date === today ? 'hoy' : 'mañana';
      expect(sentTo(patient.phone)[0].message).toContain(`tienes una cita ${label} `);
      expect(sentTo(patient.email)[0].html).toContain(`Tienes una cita ${label} `);
    }
  });

  it('reads appointment times with CLINIC_UTC_OFFSET_MINUTES instead of the server timezone', async () => {
    // 26 hours away in real time: outside the window with the default UTC-5 offset...
    const { patient } = await setup({ hoursFromNow: 26 });
    await sendReminders();
    expect(sentTo(patient.phone)).toHaveLength(0);

    // ...but the same wall-clock text read as UTC (offset 0) is only 21 hours away.
    process.env.CLINIC_UTC_OFFSET_MINUTES = '0';
    let isolated;
    jest.isolateModules(() => {
      isolated = {
        task: require('../src/tasks/reminderTask'),
        prisma: require('../src/config/prisma'),
        ns: require('../src/services/notificationService')
      };
    });
    try {
      const sent = [];
      isolated.ns.sendWhatsApp = async (to, message) => sent.push({ to, message }) && true;
      isolated.ns.sendEmail = async () => true;

      await isolated.task.sendReminders();

      expect(sent.map((m) => m.to)).toEqual([patient.phone]);
    } finally {
      delete process.env.CLINIC_UTC_OFFSET_MINUTES;
      await isolated.prisma.$disconnect();
    }
  });
});

describe('POST /api/tasks/reminders', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/tasks/reminders');

    expect(res.status).toBe(401);
  });

  it('is forbidden for a regular doctor', async () => {
    const { token } = await createUser();

    const res = await request(app).post('/api/tasks/reminders').set(bearer(token));

    expect(res.status).toBe(403);
  });

  it.each(['admin', 'secretary'])('lets %s trigger the reminders', async (role) => {
    const { patient } = await setup({ hoursFromNow: 3 });
    const staff = await createUser({ role });

    const res = await request(app).post('/api/tasks/reminders').set(bearer(staff.token));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Reminders task triggered manually');
    expect(sentTo(patient.phone)).toHaveLength(1);
  });
});
