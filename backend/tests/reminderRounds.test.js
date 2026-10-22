const request = require('supertest');
const app = require('../src/server');
const { sendReminders, dayLabelFor } = require('../src/tasks/reminderTask');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');
const { clinicParts, HOUR } = require('./helpers/time');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});
afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

const sentTo = (to) => notifications.sent.filter((m) => m.to === to);
const reload = (apt) => prisma.appointment.findUnique({ where: { id: apt.id } });

// An appointment `hoursFromNow` ahead for a new patient of `clinic` (the default clinic when omitted)
async function book({ hoursFromNow, clinic, status = 'confirmed', patient: patientData = {}, ...rest }) {
  const { user } = await createUser({ name: 'Dr. Santiago Pérez', ...(clinic && { clinic }) });
  const patient = await createPatient({ ...(clinic && { clinic }), ...patientData });
  const appointment = await createAppointment({ doctor: user, patient, status, ...clinicParts(hoursFromNow), ...rest });
  return { patient, appointment };
}

describe('dayLabelFor', () => {
  it('says the day as the patient would, counted in the clinic\'s calendar', () => {
    expect(dayLabelFor('2030-03-10', '2030-03-10')).toBe('hoy');
    expect(dayLabelFor('2030-03-11', '2030-03-10')).toBe('mañana');
    expect(dayLabelFor('2030-03-12', '2030-03-10')).toBe('pasado mañana');
    expect(dayLabelFor('2030-03-13', '2030-03-10')).toBe('el');
    // across the end of a month, and of February in a leap year
    expect(dayLabelFor('2030-03-01', '2030-02-28')).toBe('mañana');
    expect(dayLabelFor('2030-03-03', '2030-02-28')).toBe('el');
    expect(dayLabelFor('2032-03-01', '2032-02-28')).toBe('pasado mañana');
  });
});

describe('how long before', () => {
  it('reminds 48 hours ahead when the clinic chose it, and not a day earlier than that', async () => {
    const clinic = await createClinic({ reminderHours: 48 });
    const near = await book({ hoursFromNow: 40, clinic });
    const far = await book({ hoursFromNow: 50, clinic });

    await sendReminders();

    expect(sentTo(near.patient.phone)).toHaveLength(1);
    expect(sentTo(far.patient.phone)).toHaveLength(0);
    expect((await reload(near.appointment)).reminderSentAt).toBeInstanceOf(Date);
    expect((await reload(far.appointment)).reminderSentAt).toBeNull();
  });

  it('reminds only 2 hours ahead when the clinic chose that', async () => {
    const clinic = await createClinic({ reminderHours: 2 });
    const soon = await book({ hoursFromNow: 1.5, clinic });
    const dayBefore = await book({ hoursFromNow: 20, clinic });

    await sendReminders();

    expect(sentTo(soon.patient.phone)).toHaveLength(1);
    expect(sentTo(dayBefore.patient.phone)).toHaveLength(0);
  });

  it('keeps every clinic to its own hours', async () => {
    const early = await createClinic({ reminderHours: 48 });
    const usual = await createClinic();
    const inEarly = await book({ hoursFromNow: 40, clinic: early });
    const inUsual = await book({ hoursFromNow: 40, clinic: usual });

    await sendReminders();

    expect(sentTo(inEarly.patient.phone)).toHaveLength(1);
    expect(sentTo(inUsual.patient.phone)).toHaveLength(0);
  });

  it('says which day it is when the appointment is two days away', async () => {
    const clinic = await createClinic({ reminderHours: 48 });
    const { patient, appointment } = await book({ hoursFromNow: 47, clinic });

    await sendReminders();

    const label = dayLabelFor(appointment.date, clinicParts(0).date);
    expect(['pasado mañana', 'mañana']).toContain(label);
    expect(sentTo(patient.phone)[0].message).toContain(`tienes una cita ${label} ${appointment.date} a las ${appointment.time}`);
  });

  it('is unchanged for a clinic that never touched the settings: 24 hours, WhatsApp and email', async () => {
    const { patient, appointment } = await book({ hoursFromNow: 20, patient: { email: 'paciente@example.test' } });
    const far = await book({ hoursFromNow: 30 });

    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(1);
    expect(sentTo('paciente@example.test')).toHaveLength(1);
    expect(sentTo(far.patient.phone)).toHaveLength(0);
    expect(sentTo(patient.phone)[0].context).toMatchObject({ kind: 'appointment_reminder', appointmentId: appointment.id });
  });
});

describe('turning the reminders off, and the channels', () => {
  it('sends nothing for a clinic that turned them off, and leaves its appointments owed', async () => {
    const off = await createClinic({ reminderEnabled: false });
    const on = await createClinic();
    const quiet = await book({ hoursFromNow: 3, clinic: off });
    const loud = await book({ hoursFromNow: 3, clinic: on });

    await sendReminders();

    expect(notifications.sent.filter((m) => m.to === quiet.patient.phone)).toHaveLength(0);
    expect((await reload(quiet.appointment)).reminderSentAt).toBeNull();
    expect(sentTo(loud.patient.phone)).toHaveLength(1);
  });

  it('starts reminding again from the next run when they are turned back on', async () => {
    const clinic = await createClinic({ reminderEnabled: false });
    const { patient } = await book({ hoursFromNow: 3, clinic });
    await sendReminders();
    expect(sentTo(patient.phone)).toHaveLength(0);

    await prisma.clinic.update({ where: { id: clinic.id }, data: { reminderEnabled: true } });
    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(1);
  });

  it('sends only by WhatsApp when the clinic turned the email off', async () => {
    const clinic = await createClinic({ reminderEmail: false });
    const { patient } = await book({ hoursFromNow: 3, clinic, patient: { email: 'paciente@example.test' } });

    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(1);
    expect(sentTo('paciente@example.test')).toHaveLength(0);
  });

  it('sends only the email when the clinic turned WhatsApp off, and nothing for a patient without email', async () => {
    const clinic = await createClinic({ reminderWhatsapp: false });
    const withEmail = await book({ hoursFromNow: 3, clinic, patient: { email: 'paciente@example.test' } });
    const without = await book({ hoursFromNow: 3, clinic });

    await sendReminders();

    expect(sentTo(withEmail.patient.phone)).toHaveLength(0);
    expect(sentTo('paciente@example.test')).toHaveLength(1);
    expect(notifications.sent.filter((m) => m.to === without.patient.phone)).toHaveLength(0);
    // nothing reached the patient without an email, so the reminder stays owed (it is retried, not lost)
    expect((await reload(without.appointment)).reminderSentAt).toBeNull();
    expect((await reload(withEmail.appointment)).reminderSentAt).toBeInstanceOf(Date);
  });

  it('sends nothing for a clinic left with no channel at all', async () => {
    const clinic = await createClinic({ reminderWhatsapp: false, reminderEmail: false });
    const { patient, appointment } = await book({ hoursFromNow: 3, clinic, patient: { email: 'paciente@example.test' } });

    await sendReminders();

    expect(notifications.sent).toHaveLength(0);
    expect((await reload(appointment)).reminderSentAt).toBeNull();
    expect(patient).toBeTruthy();
  });

  it('also follows the settings when an admin triggers the reminders by hand', async () => {
    const off = await createClinic({ reminderEnabled: false });
    const admin = await createUser({ role: 'admin', clinic: off });
    const { patient } = await book({ hoursFromNow: 3, clinic: off });

    const res = await request(app).post('/api/tasks/reminders').set(bearer(admin.token));

    expect(res.status).toBe(200);
    expect(notifications.sent.filter((m) => m.to === patient.phone)).toHaveLength(0);
  });
});

describe('the second reminder', () => {
  it('goes out when the appointment gets close, after the first one', async () => {
    const clinic = await createClinic({ reminderHours: 48, secondReminderHours: 2 });
    // the first reminder went out 30 hours ago; the visit is now 1.5 hours away
    const { patient, appointment } = await book({ hoursFromNow: 1.5, clinic, reminderSentAt: new Date(Date.now() - 30 * HOUR) });

    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(1);
    expect(sentTo(patient.phone)[0].context.kind).toBe('appointment_second_reminder');
    const stored = await reload(appointment);
    expect(stored.secondReminderSentAt).toBeInstanceOf(Date);
    expect(stored.reminderSentAt.getTime()).toBeLessThan(Date.now() - 29 * HOUR); // the first date was not touched
  });

  it('is not sent while the appointment is still far, and the first one goes out as usual', async () => {
    const clinic = await createClinic({ reminderHours: 48, secondReminderHours: 2 });
    const { patient, appointment } = await book({ hoursFromNow: 40, clinic });

    await sendReminders();

    expect(sentTo(patient.phone).map((m) => m.context.kind)).toEqual(['appointment_reminder']);
    const stored = await reload(appointment);
    expect(stored.reminderSentAt).toBeInstanceOf(Date);
    expect(stored.secondReminderSentAt).toBeNull();
  });

  it('is skipped when the first one already went out inside its window, so nobody is told twice in a row', async () => {
    const clinic = await createClinic({ reminderHours: 24, secondReminderHours: 2 });
    // booked an hour before the visit: the first reminder goes now, and the second would be the same minute
    const { patient, appointment } = await book({ hoursFromNow: 1, clinic });

    await sendReminders();
    await sendReminders();

    expect(sentTo(patient.phone).map((m) => m.context.kind)).toEqual(['appointment_reminder']);
    // it is dated, so it is not owed any more
    expect((await reload(appointment)).secondReminderSentAt).toBeInstanceOf(Date);
  });

  it('is sent once, however many runs follow', async () => {
    const clinic = await createClinic({ reminderHours: 48, secondReminderHours: 2 });
    const { patient } = await book({ hoursFromNow: 1.5, clinic, reminderSentAt: new Date(Date.now() - 30 * HOUR) });

    await sendReminders();
    await sendReminders();
    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(1);
  });

  it('is not sent for a cancelled or closed appointment', async () => {
    const clinic = await createClinic({ reminderHours: 48, secondReminderHours: 2 });
    const cancelled = await book({ hoursFromNow: 1.5, clinic, status: 'cancelled', reminderSentAt: new Date(Date.now() - 30 * HOUR) });
    const done = await book({ hoursFromNow: 1.5, clinic, status: 'completed', reminderSentAt: new Date(Date.now() - 30 * HOUR) });

    await sendReminders();

    expect(notifications.sent.filter((m) => [cancelled.patient.phone, done.patient.phone].includes(m.to))).toHaveLength(0);
  });

  it('is not sent by a clinic that has none', async () => {
    const { patient } = await book({ hoursFromNow: 1.5, reminderSentAt: new Date(Date.now() - 20 * HOUR) });

    await sendReminders();

    expect(sentTo(patient.phone)).toHaveLength(0);
  });

  it('is released for a retry when nothing is delivered, without touching the first reminder', async () => {
    const clinic = await createClinic({ reminderHours: 48, secondReminderHours: 2 });
    const { patient, appointment } = await book({ hoursFromNow: 1.5, clinic, reminderSentAt: new Date(Date.now() - 30 * HOUR) });
    notifications.failPhones.add(patient.phone);

    await sendReminders();

    const stored = await reload(appointment);
    expect(stored.secondReminderSentAt).toBeNull();
    expect(stored.reminderSentAt).toBeInstanceOf(Date);

    notifications.failPhones.clear();
    await sendReminders();
    expect(sentTo(patient.phone)).toHaveLength(1);
  });
});

describe('the clinic\'s details in the reminder', () => {
  it('adds the address and the indications to the WhatsApp text and to the email', async () => {
    const clinic = await createClinic({ name: 'Consultorio Torres', address: 'Av. Amazonas N34-12', reminderIndications: 'Llegar 10 minutos antes' });
    const { patient } = await book({ hoursFromNow: 3, clinic, patient: { email: 'paciente@example.test' } });

    await sendReminders();

    const [whatsapp] = sentTo(patient.phone);
    expect(whatsapp.template).toMatchObject({ name: 'recordatorio_cita_consultorio' });
    expect(whatsapp.message).toContain('Recordatorio de Consultorio Torres:');
    expect(whatsapp.message).toContain('Dónde y cómo llegar: Av. Amazonas N34-12. Llegar 10 minutos antes.');
    const [email] = sentTo('paciente@example.test');
    expect(email.html).toContain('en <strong>Consultorio Torres</strong>');
    expect(email.html).toContain('<li><strong>Dirección:</strong> Av. Amazonas N34-12</li>');
    expect(email.html).toContain('<li><strong>Indicaciones:</strong> Llegar 10 minutos antes</li>');
  });

  it('keeps the approved text, with nothing added, for a clinic that set no details', async () => {
    const clinic = await createClinic({ name: 'Consultorio Torres' });
    const { patient } = await book({ hoursFromNow: 3, clinic, patient: { email: 'paciente@example.test' } });

    await sendReminders();

    const [whatsapp] = sentTo(patient.phone);
    expect(whatsapp.template).toMatchObject({ name: 'recordatorio_cita' });
    expect(whatsapp.message).toMatch(/^Recordatorio MedCita: Hola /);
    expect(sentTo('paciente@example.test')[0].html).not.toContain('Dirección');
  });

  it('writes what a person typed safely in the email', async () => {
    const clinic = await createClinic({ address: '<script>alert(1)</script>', reminderIndications: 'Tocar "timbre" & esperar' });
    const { patient } = await book({ hoursFromNow: 3, clinic, patient: { email: 'paciente@example.test' } });

    await sendReminders();

    const { html } = sentTo('paciente@example.test')[0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; esperar');
    expect(patient).toBeTruthy();
  });
});
