const mockSendGridSend = jest.fn();
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: (...args) => mockSendGridSend(...args) }));

const request = require('supertest');
const app = require('../src/server');
const { sendReminders } = require('../src/tasks/reminderTask');
const { waitForBackgroundWork } = require('../src/services/passwordResetService');
const { FAILURE_ALERT_STREAK, forAppointment } = require('../src/services/notificationLog');
const notificationService = require('../src/services/notificationService');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { MONDAY, TUESDAY, clinicParts } = require('./helpers/time');

const META = { META_WHATSAPP_TOKEN: 'test-token', META_WHATSAPP_PHONE_NUMBER_ID: '1234567890' };
const BREVO = { BREVO_API_KEY: 'brevo-key', BREVO_FROM_EMAIL: 'no-reply@medcita.test' };
const SENDGRID = { SENDGRID_API_KEY: 'sg-key', SENDGRID_FROM_EMAIL: 'no-reply@medcita.test' };

let saved;
let metaReply;
let brevoReply;

const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

beforeEach(async () => {
  await resetDb();
  saved = { ...process.env };
  Object.assign(process.env, META, BREVO);
  metaReply = () => reply(200, { messages: [{ id: 'wamid.HBgM123' }] });
  brevoReply = () => reply(201, { messageId: '<202610221200.1@smtp-relay.mailin.fr>' });
  mockSendGridSend.mockReset();
  jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('graph.facebook.com')) return metaReply();
    if (String(url).includes('api.brevo.com')) return brevoReply();
    throw new Error(`unexpected request to ${url}`);
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await waitForBackgroundWork();
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  jest.restoreAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => prisma.$disconnect());

const rows = (where = {}) => prisma.notificationLog.findMany({ where, orderBy: [{ channel: 'asc' }, { kind: 'asc' }, { createdAt: 'asc' }] });

// A doctor with a staff member, and a booking made through the API
async function book({ patientEmail = 'paciente@example.test' } = {}) {
  const clinic = await createClinic({ name: 'Consultorio Torres' });
  const doctor = await createUser({ clinic, name: 'Dra. Torres', email: 'dra.torres@example.test' });
  const res = await request(app).post('/api/appointments').set(bearer(doctor.token)).send({
    patientName: 'María Andrade',
    patientPhone: '+593990000042',
    patientEmail,
    date: TUESDAY,
    time: '10:00'
  });
  expect(res.status).toBe(201);
  return { clinic, doctor, appointment: res.body };
}

describe('what a booking leaves in the history', () => {
  it('one row per message: the patient\'s WhatsApp and email and the doctor\'s email, all sent', async () => {
    const { clinic, appointment } = await book();

    const all = await rows();

    expect(all.map((r) => [r.kind, r.channel, r.provider, r.recipient, r.status])).toEqual([
      ['appointment_confirmation', 'email', 'brevo', 'patient', 'sent'],
      ['doctor_new_appointment', 'email', 'brevo', 'doctor', 'sent'],
      ['appointment_confirmation', 'whatsapp', 'meta', 'patient', 'sent']
    ]);
    for (const row of all) expect(row).toMatchObject({ clinicId: clinic.id, appointmentId: appointment.id, errorCode: null, error: null });
    expect(all.find((r) => r.channel === 'whatsapp').providerMessageId).toBe('wamid.HBgM123');
    expect(all.find((r) => r.recipient === 'patient' && r.channel === 'email').providerMessageId).toBe('<202610221200.1@smtp-relay.mailin.fr>');
  });

  it('keeps a masked destination and nothing of the message or the full address', async () => {
    await book();

    const dump = JSON.stringify(await rows());

    expect(dump).toContain('+593***042');
    expect(dump).toContain('pa******@example.test');
    expect(dump).not.toMatch(/593990000042|paciente@example|dra\.torres@example|María|Andrade|Confirmaci/);
  });

  it('records why a WhatsApp failed, with the code and where to fix it, and still books the appointment', async () => {
    metaReply = () => reply(401, { error: { code: 190, message: 'Invalid OAuth access token.' } });

    const { appointment } = await book();

    const failedRow = await prisma.notificationLog.findFirst({ where: { channel: 'whatsapp' } });
    expect(failedRow).toMatchObject({ status: 'failed', provider: 'meta', errorCode: 'meta_190', appointmentId: appointment.id });
    expect(failedRow.error).toContain('Invalid OAuth access token');
    expect(failedRow.error).toContain('META_WHATSAPP_TOKEN');
    expect(await prisma.notificationLog.count({ where: { channel: 'email', status: 'sent' } })).toBe(2);
  });

  it('records a network failure and a timeout apart from provider errors', async () => {
    metaReply = () => { throw new Error('socket hang up'); };
    brevoReply = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };

    await book();

    expect((await rows({ channel: 'whatsapp' }))[0]).toMatchObject({ status: 'failed', errorCode: 'network', error: 'socket hang up' });
    const emails = await rows({ channel: 'email' });
    expect(emails.map((r) => [r.provider, r.status, r.errorCode])).toEqual([['brevo', 'failed', 'timeout'], ['brevo', 'failed', 'timeout']]);
  });

  it('records a Brevo error with its code and message', async () => {
    brevoReply = () => reply(401, { code: 'unauthorized', message: 'Key not found' });

    await book();

    const email = await prisma.notificationLog.findFirst({ where: { channel: 'email', recipient: 'patient' } });
    expect(email).toMatchObject({ status: 'failed', provider: 'brevo', errorCode: 'brevo_unauthorized', error: '401 Key not found' });
  });

  it('records the fallback: SendGrid delivered what Brevo could not, and the row says so', async () => {
    Object.assign(process.env, SENDGRID);
    brevoReply = () => reply(500, { code: 'server_error', message: 'try later' });
    mockSendGridSend.mockResolvedValue([{ headers: { 'x-message-id': 'sg-abc' } }]);

    await book();

    const email = await prisma.notificationLog.findFirst({ where: { channel: 'email', recipient: 'patient' } });
    expect(email).toMatchObject({ status: 'sent', provider: 'sendgrid', providerMessageId: 'sg-abc', errorCode: 'brevo_server_error' });
    expect(email.error).toBe('Brevo failed (500 try later); sent through SendGrid');
  });

  it('marks a message as simulated when no provider is configured: nothing really left', async () => {
    Object.assign(process.env, { META_WHATSAPP_TOKEN: '', META_WHATSAPP_PHONE_NUMBER_ID: '', BREVO_API_KEY: '', BREVO_FROM_EMAIL: '' });

    await book();

    const all = await rows();
    expect(all).toHaveLength(3);
    for (const row of all) expect(row).toMatchObject({ provider: 'mock', status: 'simulated' });
  });

  it('hides emails and phone numbers that a provider repeats in its error', async () => {
    metaReply = () => reply(400, { error: { code: 131026, message: 'Message to +593990000042 undeliverable; contact paciente@example.test' } });

    await book();

    const row = await prisma.notificationLog.findFirst({ where: { channel: 'whatsapp' } });
    expect(row.error).not.toMatch(/593990000042|paciente@example/);
    expect(row.error).toContain('***');
  });

  it('keeps an error to 300 characters', async () => {
    metaReply = () => reply(500, { error: { code: 1, message: 'x'.repeat(2000) } });

    await book();

    expect((await prisma.notificationLog.findFirst({ where: { channel: 'whatsapp' } })).error.length).toBeLessThanOrEqual(300);
  });

  it('does not fail the booking nor stop the other messages when the note cannot be written', async () => {
    jest.spyOn(prisma.notificationLog, 'create').mockRejectedValue(new Error('disk full'));

    const { appointment } = await book();

    expect(appointment.id).toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(3); // WhatsApp + the two emails still went out
  });

  it('still answers that the message went out when the note about it cannot be written', async () => {
    jest.spyOn(prisma.notificationLog, 'create').mockRejectedValue(new Error('disk full'));
    const context = { kind: 'appointment_reminder', recipient: 'patient' };

    expect(await notificationService.sendWhatsApp('+593990000042', 'hola', undefined, context)).toBe(true);
    expect(await notificationService.sendEmail('paciente@example.test', 'Asunto', 'texto', '<p>texto</p>', context)).toBe(true);
  });

  it('writes nothing for a message sent without saying what it was for', async () => {
    await notificationService.sendWhatsApp('+593990000042', 'hola');

    expect(await prisma.notificationLog.count()).toBe(0);
  });

  it('does not hand out the history of an appointment to another clinic, even with its id', async () => {
    const { appointment, clinic } = await book();
    const other = await createClinic({ name: 'Otra' });

    expect((await forAppointment(other.id, appointment.id))).toEqual([]);
    expect((await forAppointment(clinic.id, appointment.id)).length).toBe(3);
  });

  it('writes no row for a patient without email (no email was attempted)', async () => {
    await book({ patientEmail: '' });

    expect((await rows()).map((r) => [r.kind, r.channel])).toEqual([['doctor_new_appointment', 'email'], ['appointment_confirmation', 'whatsapp']]);
  });
});

describe('reminders, resets, sign-ups and invitations', () => {
  it('records the 24h reminder on each channel, against the appointment', async () => {
    const doctor = await createUser({ name: 'Dra. Torres' });
    const patient = await createPatient({ clinic: { id: doctor.user.clinicId }, email: 'paciente@example.test' });
    const appointment = await createAppointment({ doctor: doctor.user, patient, ...clinicParts(3) });

    await sendReminders();

    expect((await rows()).map((r) => [r.kind, r.channel, r.status, r.appointmentId])).toEqual([
      ['appointment_reminder', 'email', 'sent', appointment.id],
      ['appointment_reminder', 'whatsapp', 'sent', appointment.id]
    ]);
  });

  it('records a reminder that did not go out, and the task releases it to try again', async () => {
    metaReply = () => reply(401, { error: { code: 190, message: 'expired' } });
    const doctor = await createUser();
    const patient = await createPatient({ clinic: { id: doctor.user.clinicId } });
    const appointment = await createAppointment({ doctor: doctor.user, patient, ...clinicParts(3) });

    await sendReminders();

    expect(await rows()).toEqual([expect.objectContaining({ kind: 'appointment_reminder', status: 'failed', errorCode: 'meta_190' })]);
    expect((await prisma.appointment.findUnique({ where: { id: appointment.id } })).reminderSentAt).toBeNull();
  });

  it('records the password reset email in the clinic of the account', async () => {
    const { user } = await createUser({ email: 'doc@example.test' });

    await request(app).post('/api/auth/forgot-password').send({ email: 'doc@example.test' });
    await waitForBackgroundWork();

    expect(await rows()).toEqual([expect.objectContaining({ kind: 'password_reset', channel: 'email', recipient: 'user', clinicId: user.clinicId, status: 'sent' })]);
  });

  it('records the sign-up confirmation and the account-exists notice with no clinic', async () => {
    await createUser({ email: 'known@example.test' });
    await request(app).post('/api/auth/register').send({ name: 'Ana', email: 'new@example.test', password: 'secret123', clinicName: 'Consultorio Ana' });
    await request(app).post('/api/auth/register').send({ name: 'Ana', email: 'known@example.test', password: 'secret123', clinicName: 'Consultorio Ana' });
    const { waitForBackgroundWork: waitSignup } = require('../src/services/signupService');
    await waitSignup();

    expect((await rows()).map((r) => [r.kind, r.clinicId, r.status])).toEqual([
      ['account_exists', null, 'sent'],
      ['signup_confirmation', null, 'sent']
    ]);
  });

  it('records an invitation in the clinic that sent it, and a failed one so the admin can resend', async () => {
    brevoReply = () => reply(500, { code: 'server_error', message: 'try later' });
    const admin = await createUser({ role: 'admin' });

    const res = await request(app).post('/api/admin/doctors').set(bearer(admin.token)).send({ name: 'Marta', email: 'marta@example.test', role: 'secretary' });

    expect(res.body.delivered).toBe(false);
    expect(await rows()).toEqual([expect.objectContaining({ kind: 'invitation', clinicId: admin.user.clinicId, status: 'failed', recipient: 'user' })]);
  });
});

describe('GET /api/appointments/:id/notifications', () => {
  const read = (token, id) => request(app).get(`/api/appointments/${id}/notifications`).set(bearer(token));

  it('lists what was sent about the appointment, newest first, and says if the reminder is still owed', async () => {
    const { doctor, appointment } = await book();

    const res = await read(doctor.token, appointment.id);

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(3);
    expect(res.body.notifications[0]).toEqual({
      id: expect.any(String), createdAt: expect.any(String), kind: expect.any(String), channel: expect.any(String),
      provider: expect.any(String), recipient: expect.any(String), status: 'sent', errorCode: null, error: null, destination: expect.any(String)
    });
    expect(res.body.reminderPending).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/providerMessageId|clinicId|appointmentId/);
  });

  it('shows the failure and, once the reminder was sent, no longer owes it', async () => {
    metaReply = () => reply(401, { error: { code: 190, message: 'expired' } });
    const { doctor, appointment } = await book();
    await prisma.appointment.update({ where: { id: appointment.id }, data: { reminderSentAt: new Date() } });

    const res = await read(doctor.token, appointment.id);

    expect(res.body.notifications.find((n) => n.channel === 'whatsapp')).toMatchObject({ status: 'failed', errorCode: 'meta_190' });
    expect(res.body.reminderPending).toBe(false);
  });

  it('is 404 for a doctor who does not own it, for another clinic, and 401 without a token', async () => {
    const { doctor, appointment, clinic } = await book();
    const colleague = await createUser({ clinic });
    const outsider = await createUser({ role: 'admin', clinic: await createClinic({ name: 'Otra' }) });
    const secretary = await createUser({ role: 'secretary', clinic });

    expect((await read(colleague.token, appointment.id)).status).toBe(404);
    expect((await read(outsider.token, appointment.id)).status).toBe(404);
    expect((await read(secretary.token, appointment.id)).status).toBe(200);
    expect((await read(doctor.token, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await request(app).get(`/api/appointments/${appointment.id}/notifications`)).status).toBe(401);
  });
});

describe('GET /api/admin/notification-status', () => {
  const status = (token) => request(app).get('/api/admin/notification-status').set(bearer(token));
  const log = (clinicId, channel, state, minutesAgo, extra = {}) =>
    prisma.notificationLog.create({
      data: { clinicId, channel, kind: 'appointment_reminder', provider: channel === 'email' ? 'brevo' : 'meta', recipient: 'patient',
        status: state, destination: '***', createdAt: new Date(Date.now() - minutesAgo * 60000),
        ...(state === 'failed' && { errorCode: 'meta_190', error: 'expired token' }), ...extra }
    });

  it('warns once a channel has failed several messages in a row, with the last reason', async () => {
    const admin = await createUser({ role: 'admin' });
    const cid = admin.user.clinicId;
    await log(cid, 'whatsapp', 'sent', 60);
    for (let i = 0; i < FAILURE_ALERT_STREAK; i++) await log(cid, 'whatsapp', 'failed', 30 - i);

    const res = await status(admin.token);

    expect(res.status).toBe(200);
    expect(res.body.alertAfter).toBe(FAILURE_ALERT_STREAK);
    expect(res.body.channels.whatsapp).toMatchObject({ failing: true, failedInARow: FAILURE_ALERT_STREAK, lastFailure: { errorCode: 'meta_190', error: 'expired token', provider: 'meta' } });
    expect(res.body.channels.whatsapp.lastSentAt).not.toBeNull();
    expect(res.body.channels.email).toMatchObject({ failing: false, failedInARow: 0, lastFailure: null });
  });

  it('does not warn for fewer failures than that, and stops warning after one message goes out', async () => {
    const admin = await createUser({ role: 'admin' });
    const cid = admin.user.clinicId;
    for (let i = 0; i < FAILURE_ALERT_STREAK - 1; i++) await log(cid, 'whatsapp', 'failed', 30 - i);
    expect((await status(admin.token)).body.channels.whatsapp.failing).toBe(false);

    await log(cid, 'whatsapp', 'failed', 10);
    expect((await status(admin.token)).body.channels.whatsapp.failing).toBe(true);

    await log(cid, 'whatsapp', 'sent', 5);
    expect((await status(admin.token)).body.channels.whatsapp).toMatchObject({ failing: false, failedInARow: 0 });
  });

  it('ignores simulated sends, and old history', async () => {
    const admin = await createUser({ role: 'admin' });
    const cid = admin.user.clinicId;
    for (let i = 0; i < 5; i++) await log(cid, 'email', 'failed', 9 * 24 * 60 + i); // nine days ago
    await log(cid, 'whatsapp', 'simulated', 5);

    const res = await status(admin.token);

    expect(res.body.channels.email).toMatchObject({ failing: false, failedInARow: 0 });
    expect(res.body.channels.whatsapp).toMatchObject({ failing: false, simulated: true });
  });

  it('only counts the clinic of the admin, and is closed to everyone else', async () => {
    const admin = await createUser({ role: 'admin' });
    const other = await createUser({ role: 'admin', clinic: await createClinic({ name: 'Otra' }) });
    for (let i = 0; i < 5; i++) await log(other.user.clinicId, 'whatsapp', 'failed', 10 + i);
    const doctor = await createUser({ clinic: { id: admin.user.clinicId } });

    expect((await status(admin.token)).body.channels.whatsapp.failing).toBe(false);
    expect((await status(other.token)).body.channels.whatsapp.failing).toBe(true);
    expect((await status(doctor.token)).status).toBe(403);
    expect((await request(app).get('/api/admin/notification-status')).status).toBe(401);
  });
});
