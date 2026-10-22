const request = require('supertest');
const app = require('../src/server');
const notificationService = require('../src/services/notificationService');
const notificationLog = require('../src/services/notificationLog');
const { buttonPayload } = require('../src/services/whatsappButtons');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { clinicParts } = require('./helpers/time');
const { APP_SECRET, VERIFY_TOKEN, buttonMessage, webhookBody, postWebhook, tap, waitFor } = require('./helpers/whatsappWebhook');

// The number Meta reports for María, and how it is written in her patient record
const FROM = '593990000042';
const PHONE = '+593990000042';

let sendWhatsApp;
let sendEmail;

beforeEach(async () => {
  await resetDb();
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // Both go through to the mock providers (nothing is configured), so they leave their rows in the history
  sendWhatsApp = jest.spyOn(notificationService, 'sendWhatsApp');
  sendEmail = jest.spyOn(notificationService, 'sendEmail');
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;
});
afterAll(() => prisma.$disconnect());

// A visit `hoursFromNow` ahead for María, with a doctor of the clinic (the shared test clinic when omitted)
async function book({ hoursFromNow = 30, status = 'pending_approval', phone = PHONE, clinic, patientName = 'María Andrade', ...rest } = {}) {
  const { user: doctor } = await createUser({ name: 'Dr. Santiago Pérez', ...(clinic && { clinic }) });
  const patient = await createPatient({ ...(clinic && { clinic }), name: patientName, phone });
  const appointment = await createAppointment({ doctor, patient, status, ...clinicParts(hoursFromNow), ...rest });
  return { doctor, patient, appointment };
}

const reload = (appointment) => prisma.appointment.findUnique({ where: { id: appointment.id } });
const history = (appointment) => prisma.notificationLog.findMany({ where: { appointmentId: appointment.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
const received = async (appointment) => (await history(appointment)).filter((row) => row.status === 'received');
const audits = () => prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
const answers = () => sendWhatsApp.mock.calls.map(([to, message, template, context]) => ({ to, message, template, context }));
const answered = (count = 1) => waitFor(() => sendWhatsApp.mock.calls.length >= count);
// For the cases where nothing must go out: give a (wrongly) sent answer time to show up
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('GET /api/webhooks/whatsapp (Meta checks the address)', () => {
  const verify = (query) => request(app).get('/api/webhooks/whatsapp').query(query);

  it('gives Meta its challenge back, as plain text, when the token is the one we agreed on', async () => {
    const res = await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toBe('1158201444');
  });

  it.each([
    ['a wrong token', { 'hub.mode': 'subscribe', 'hub.verify_token': 'not-the-token', 'hub.challenge': '1' }],
    ['no token', { 'hub.mode': 'subscribe', 'hub.challenge': '1' }],
    ['another mode', { 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1' }],
    ['nothing at all', {}]
  ])('refuses %s', async (_label, query) => {
    const res = await verify(query);

    expect(res.status).toBe(403);
    expect(res.text).not.toContain(VERIFY_TOKEN);
  });

  it('does not echo back a challenge that is not the number Meta sends', async () => {
    const res = await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '<script>alert(1)</script>' });

    expect(res.status).toBe(400);
    expect(res.text).not.toContain('script');
  });

  it('is off, with a 503, until the verify token is set', async () => {
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;

    const res = await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' });

    expect(res.status).toBe(503);
  });

  it('stops whoever keeps guessing the token, after 30 wrong ones', async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': `guess-${attempt}`, 'hub.challenge': '1' })).status).toBe(403);
    }

    const res = await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess-31', 'hub.challenge': '1' });

    expect(res.status).toBe(429);
  });
});

describe('POST /api/webhooks/whatsapp (the signature)', () => {
  const noise = webhookBody(undefined, { statuses: [{ id: 'wamid.x', status: 'delivered' }] });

  it('accepts a call signed with the app secret', async () => {
    const res = await postWebhook(noise);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it.each([
    ['without a signature', { signature: null }],
    ['with an empty signature', { signature: '' }],
    ['with a signature that does not start with sha256=', { signature: 'abc123' }],
    ['signed with another secret', { secret: 'somebody-elses-secret' }],
    ['with a signature of the right shape and the wrong value', { signature: `sha256=${'0'.repeat(64)}` }]
  ])('refuses a call %s', async (_label, options) => {
    const res = await postWebhook(noise, options);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Invalid signature' });
  });

  it('refuses a body that was changed after it was signed', async () => {
    const { appointment } = await book();
    const body = webhookBody([buttonMessage({ from: FROM, payload: buttonPayload('confirm', appointment) })]);
    const signedFor = JSON.stringify(body);
    const changed = signedFor.replace(FROM, '593991111111');

    const res = await postWebhook(null, { raw: changed, signature: `sha256=${require('crypto').createHmac('sha256', APP_SECRET).update(signedFor).digest('hex')}` });

    expect(res.status).toBe(403);
    expect((await reload(appointment)).status).toBe('pending_approval');
  });

  it('does nothing, however well formed, when the signature is wrong', async () => {
    const { appointment } = await book();

    const res = await postWebhook(webhookBody([buttonMessage({ from: FROM, payload: buttonPayload('cancel', appointment) })]), { secret: 'wrong' });

    expect(res.status).toBe(403);
    expect((await reload(appointment)).status).toBe('pending_approval');
    expect(await prisma.notificationLog.count()).toBe(0);
    expect(await audits()).toEqual([]);
  });

  it('is off, with a 503, until the app secret is set: nothing can be checked, so nothing is accepted', async () => {
    const { appointment } = await book();
    delete process.env.META_APP_SECRET;

    const res = await postWebhook(webhookBody([buttonMessage({ from: FROM, payload: buttonPayload('cancel', appointment) })]));

    expect(res.status).toBe(503);
    expect((await reload(appointment)).status).toBe('pending_approval');
  });

  it('answers 400 to a signed body that is not JSON', async () => {
    const res = await postWebhook(null, { raw: '{this is not json' });

    expect(res.status).toBe(400);
  });

  it('refuses a body over 256 kB without reading it', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {}); // the handler logs the refusal
    const res = await postWebhook(null, { raw: JSON.stringify({ padding: 'x'.repeat(300 * 1024) }) });

    expect(res.status).toBe(413);
  });

  it('never holds back Meta: calls that carry a valid signature are not counted against the address', async () => {
    for (let call = 0; call < 40; call++) {
      expect((await postWebhook(noise)).status).toBe(200);
    }
  });

  it('keeps the rest of the API reading JSON as before', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password: 'secret123' });

    expect(res.status).toBe(401);
  });
});

describe('«Confirmo»', () => {
  it('confirms the visit, tells the patient, and leaves a trace in the history and in the audit log', async () => {
    const { appointment, patient, doctor } = await book();

    const res = await tap('confirm', appointment, FROM, { id: 'wamid.HBg1' });
    await answered();

    expect(res.status).toBe(200);
    expect((await reload(appointment)).status).toBe('confirmed');

    // The answer goes to the number that wrote, as free text, and names the visit
    expect(answers()).toHaveLength(1);
    expect(answers()[0].to).toBe(FROM);
    expect(answers()[0].template).toBeNull();
    expect(answers()[0].message).toBe(`MedCita: ¡Gracias, María Andrade! Tu cita con Dr. Santiago Pérez el ${appointment.date} a las ${appointment.time} quedó confirmada. Te esperamos.`);

    const rows = await history(appointment);
    expect(rows.map((row) => [row.kind, row.status, row.recipient, row.channel, row.provider])).toEqual([
      ['patient_confirmed', 'received', 'patient', 'whatsapp', 'meta'],
      ['patient_reply_answer', 'simulated', 'patient', 'whatsapp', 'mock']
    ]);
    expect(rows[0]).toMatchObject({ clinicId: appointment.clinicId, providerMessageId: 'wamid.HBg1', destination: '+593***042', errorCode: null });

    const [entry, ...others] = await audits();
    expect(others).toEqual([]);
    expect(entry).toMatchObject({
      actorId: patient.id,
      actorName: 'Patient (WhatsApp)',
      actorRole: 'patient',
      clinicId: appointment.clinicId,
      action: 'update',
      entity: 'appointment',
      entityId: appointment.id,
      doctorId: doctor.id,
      changes: { status: { from: 'pending_approval', to: 'confirmed' } },
      ip: '127.0.0.1'
    });
    // Neither the patient's name nor their number is in the entry
    expect(JSON.stringify(entry)).not.toContain('María');
    expect(JSON.stringify(entry)).not.toContain('990000042');
  });

  it('confirms a visit that was "scheduled" too', async () => {
    const { appointment } = await book({ status: 'scheduled' });

    await tap('confirm', appointment, FROM);

    expect((await reload(appointment)).status).toBe('confirmed');
  });

  it('says it was already confirmed, and changes and records nothing new, when it was', async () => {
    const { appointment } = await book({ status: 'confirmed' });

    const res = await tap('confirm', appointment, FROM);
    await answered();

    expect(res.status).toBe(200);
    expect((await reload(appointment)).status).toBe('confirmed');
    expect(answers()[0].message).toContain('ya estaba confirmada');
    expect(await audits()).toEqual([]);
    expect((await received(appointment)).map((row) => [row.kind, row.errorCode])).toEqual([['patient_reply_ignored', 'already_confirmed']]);
  });
});

describe('«Cancelar»', () => {
  it('cancels the visit, frees the slot, tells the patient and audits it as a cancellation', async () => {
    const { appointment, doctor } = await book({ status: 'confirmed' });
    const { token } = await createUser({ role: 'admin' });

    await tap('cancel', appointment, FROM);
    await answered();

    expect((await reload(appointment)).status).toBe('cancelled');
    expect(answers()[0].message).toBe(`MedCita: Listo, María Andrade. Cancelamos tu cita con Dr. Santiago Pérez del ${appointment.date} a las ${appointment.time}. Si quieres agendar otra, comunícate con el consultorio.`);
    const [entry] = await audits();
    expect(entry).toMatchObject({ action: 'cancel', actorRole: 'patient', changes: { status: { from: 'confirmed', to: 'cancelled' } } });
    expect((await received(appointment)).map((row) => row.kind)).toEqual(['patient_cancelled']);

    // The slot can be booked again right away
    const rebooked = await request(app)
      .post('/api/appointments')
      .set(bearer(token))
      .send({ patientName: 'Otra Paciente', patientPhone: '+593990000099', date: appointment.date, time: appointment.time, doctorId: doctor.id });
    expect(rebooked.status).toBe(201);
  });

  it('says it was already cancelled, and records nothing new, when it was', async () => {
    const { appointment } = await book({ status: 'cancelled' });

    await tap('cancel', appointment, FROM);
    await answered();

    expect((await reload(appointment)).status).toBe('cancelled');
    expect(answers()[0].message).toContain('ya estaba cancelada');
    expect(await audits()).toEqual([]);
  });

  it('lets the patient cancel after confirming, but not confirm after cancelling', async () => {
    const { appointment } = await book();

    await tap('confirm', appointment, FROM);
    await tap('cancel', appointment, FROM);
    expect((await reload(appointment)).status).toBe('cancelled');

    await tap('confirm', appointment, FROM);
    await answered(3);
    expect((await reload(appointment)).status).toBe('cancelled');
    expect(answers()[2].message).toBe('MedCita: Esta cita ya no admite cambios por WhatsApp. Si necesitas ayuda, comunícate con el consultorio.');
    expect((await audits()).map((entry) => entry.action)).toEqual(['update', 'cancel']);
  });
});

describe('«Cambiar hora»', () => {
  it('changes nothing in the agenda, tells the patient, and emails the clinic\'s admins and secretaries', async () => {
    const clinic = await createClinic({ name: 'Consultorio Torres' });
    const { appointment } = await book({ clinic, patientName: 'María <b>Andrade</b>' });
    const { user: admin } = await createUser({ role: 'admin', clinic });
    const { user: secretary } = await createUser({ role: 'secretary', clinic });
    const { user: otherDoctor } = await createUser({ role: 'doctor', clinic });
    const { user: otherClinicAdmin } = await createUser({ role: 'admin', clinic: await createClinic() });

    await tap('reschedule', appointment, FROM);
    await answered();
    await waitFor(() => sendEmail.mock.calls.length >= 2);
    await settle();

    expect(await reload(appointment)).toMatchObject({ status: 'pending_approval', date: appointment.date, time: appointment.time });
    expect(answers()[0].message).toBe(`MedCita: Recibimos tu solicitud, María <b>Andrade</b>. Avisamos al consultorio para que se comunique contigo y elijan otro horario. Hasta entonces, tu cita sigue el ${appointment.date} a las ${appointment.time}.`);
    expect(await audits()).toEqual([]); // nothing in the agenda changed

    const recipients = sendEmail.mock.calls.map(([to]) => to).sort();
    expect(recipients).toEqual([admin.email, secretary.email].sort());
    expect(recipients).not.toContain(otherDoctor.email);
    expect(recipients).not.toContain(otherClinicAdmin.email);

    const [to, subject, text, html, context] = sendEmail.mock.calls[0];
    expect(subject).toBe('Un paciente pidió cambiar su cita - MedCita');
    expect(text).toContain(`del ${appointment.date} a las ${appointment.time}`);
    expect(text).toContain('Cambiar hora');
    expect(html).toContain('Consultorio Torres');
    expect(html).toContain('María &lt;b&gt;Andrade&lt;/b&gt;'); // the patient's name cannot add markup to the email
    expect(html).not.toContain('<b>Andrade');
    expect(context).toMatchObject({ kind: 'reschedule_request_notice', recipient: 'user', clinicId: clinic.id, appointmentId: appointment.id });
    expect(to).toMatch(/@example\.test$/);

    expect((await received(appointment)).map((row) => row.kind)).toEqual(['patient_reschedule_request']);
  });

  it('does not email the staff again for a second tap within a day, but still answers the patient', async () => {
    const { appointment } = await book();
    await createUser({ role: 'admin' });

    await tap('reschedule', appointment, FROM);
    await answered();
    await waitFor(() => sendEmail.mock.calls.length >= 1);
    await tap('reschedule', appointment, FROM);
    await answered(2);
    await settle();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(answers()[1].message).toBe('MedCita: María Andrade, ya avisamos al consultorio que necesitas otro horario. Se comunicarán contigo.');
    expect((await received(appointment)).map((row) => [row.kind, row.errorCode])).toEqual([
      ['patient_reschedule_request', null],
      ['patient_reply_ignored', 'repeated']
    ]);
  });

  it('emails them again for a request made more than a day after the last one', async () => {
    const { appointment } = await book();
    await createUser({ role: 'admin' });

    await tap('reschedule', appointment, FROM);
    await waitFor(() => sendEmail.mock.calls.length >= 1);
    await prisma.notificationLog.updateMany({ where: { kind: 'patient_reschedule_request' }, data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    await tap('reschedule', appointment, FROM);
    await waitFor(() => sendEmail.mock.calls.length >= 2);

    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe('what a tap does not change', () => {
  const unchanged = async (appointment, expected) => {
    await settle();
    expect((await reload(appointment)).status).toBe(expected);
    expect(await audits()).toEqual([]);
  };

  it.each(['confirm', 'cancel', 'reschedule'])('ignores «%s» for a visit whose time has passed', async (action) => {
    const { appointment } = await book({ hoursFromNow: -1, status: 'confirmed' });

    const res = await tap(action, appointment, FROM);
    await answered();

    expect(res.status).toBe(200);
    await unchanged(appointment, 'confirmed');
    expect(answers()[0].message).toContain('ya no admite cambios');
    expect((await received(appointment)).map((row) => [row.kind, row.errorCode])).toEqual([['patient_reply_ignored', 'past']]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each(['arrived', 'in_progress', 'completed', 'no_show'])('ignores a tap on a visit that is already "%s"', async (status) => {
    const { appointment } = await book({ status });

    await tap('cancel', appointment, FROM);
    await answered();

    await unchanged(appointment, status);
    expect((await received(appointment)).map((row) => row.errorCode)).toEqual(['closed']);
  });

  it.each(['confirm', 'reschedule'])('ignores «%s» for a visit that was cancelled', async (action) => {
    const { appointment } = await book({ status: 'cancelled' });

    await tap(action, appointment, FROM);
    await answered();

    await unchanged(appointment, 'cancelled');
    expect((await received(appointment)).map((row) => row.errorCode)).toEqual(['cancelled']);
  });

  it('ignores the buttons of a reminder about a visit that was moved since, and says so', async () => {
    const { appointment } = await book();
    const asReminded = { id: appointment.id, date: appointment.date, time: appointment.time };
    await prisma.appointment.update({ where: { id: appointment.id }, data: clinicParts(80) });

    await tap('cancel', asReminded, FROM);
    await answered();

    await unchanged(appointment, 'pending_approval');
    expect(answers()[0].message).toBe('MedCita: Este mensaje corresponde a un horario anterior de tu cita. Revisa tu recordatorio más reciente o comunícate con el consultorio.');
    expect((await received(appointment)).map((row) => row.errorCode)).toEqual(['stale']);
  });

  it('still obeys the buttons of a reminder when the visit was only edited (the date and time are what count)', async () => {
    const { appointment } = await book();
    await prisma.appointment.update({ where: { id: appointment.id }, data: { notes: 'trae sus exámenes' } });

    await tap('confirm', appointment, FROM);

    expect((await reload(appointment)).status).toBe('confirmed');
  });

  it('ignores a tap from another number: a reminder forwarded to a friend cannot cancel the visit', async () => {
    const { appointment } = await book();

    const res = await tap('cancel', appointment, '593991111111');
    await settle();

    expect(res.status).toBe(200);
    await unchanged(appointment, 'pending_approval');
    expect(sendWhatsApp).not.toHaveBeenCalled(); // the friend is not answered
    const rows = await history(appointment);
    expect(rows.map((row) => [row.kind, row.status, row.errorCode, row.destination])).toEqual([['patient_reply_ignored', 'received', 'other_number', '+593***111']]);
  });

  it.each([
    ['without the country code, with a leading 0', '0990000042'],
    ['with spaces and a plus', '+593 99 000 0042'],
    ['as Meta writes it', '593990000042']
  ])('recognises the patient\'s own number written %s', async (_label, phone) => {
    const { appointment } = await book({ phone });

    await tap('confirm', appointment, FROM);

    expect((await reload(appointment)).status).toBe('confirmed');
  });

  it('ignores a payload that was made up, cut, or signed with another secret, and a missing one', async () => {
    const { appointment } = await book();
    const real = buttonPayload('cancel', appointment);
    const payloads = [
      real.slice(0, -1),
      `${real.slice(0, -3)}AAA`,
      real.replace(/^x\./, 'c.'),
      `x.${appointment.id}.000000000000.${real.split('.')[3]}`,
      'x.00000000-0000-4000-8000-000000000000.203001151000.AAAAAAAAAAAAAAAAAAAAAA',
      'confirm',
      '',
      undefined
    ];

    for (const payload of payloads) {
      const res = await postWebhook(webhookBody([buttonMessage({ from: FROM, payload })]));
      expect(res.status).toBe(200);
    }
    await settle();

    await unchanged(appointment, 'pending_approval');
    expect(await prisma.notificationLog.count()).toBe(0);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('ignores a payload signed with another secret', async () => {
    const { appointment } = await book();
    const real = buttonPayload('cancel', appointment);
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'a-different-secret-0123456789-abcdefghijklmnop';
    const forged = buttonPayload('cancel', appointment);
    process.env.JWT_SECRET = original;

    expect(forged).not.toBe(real);
    await postWebhook(webhookBody([buttonMessage({ from: FROM, payload: forged })]));
    await settle();

    await unchanged(appointment, 'pending_approval');
  });

  it('ignores free text, photos and anything that is not a button, without answering', async () => {
    const { appointment } = await book();
    const messages = [
      { from: FROM, id: 'wamid.t1', type: 'text', text: { body: 'no puedo ir, cancela mi cita' } },
      { from: FROM, id: 'wamid.t2', type: 'image', image: { id: 'media' } },
      { from: FROM, id: 'wamid.t3', type: 'button', button: { text: 'Confirmo' } }
    ];

    const res = await postWebhook(webhookBody(messages));
    await settle();

    expect(res.status).toBe(200);
    await unchanged(appointment, 'pending_approval');
    expect(await prisma.notificationLog.count()).toBe(0);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('ignores a signed payload about an appointment that does not exist', async () => {
    const ghost = { id: '00000000-0000-4000-8000-000000000000', date: '2030-01-15', time: '10:00' };

    const res = await tap('cancel', ghost, FROM);
    await settle();

    expect(res.status).toBe(200);
    expect(await prisma.notificationLog.count()).toBe(0);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('skips delivery receipts and every other field', async () => {
    const body = webhookBody(undefined, { statuses: [{ id: 'wamid.s1', status: 'read', recipient_id: FROM }] });
    body.entry.push({ id: 'W2', changes: [{ field: 'account_update', value: { event: 'VERIFIED_ACCOUNT' } }] });

    const res = await postWebhook(body);

    expect(res.status).toBe(200);
    expect(await prisma.notificationLog.count()).toBe(0);
  });

  it('ignores what arrives for another number of the same app, when ours is configured', async () => {
    const { appointment } = await book();
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    const message = buttonMessage({ from: FROM, payload: buttonPayload('confirm', appointment) });

    await postWebhook(webhookBody([message], { phoneNumberId: '999999999' }));
    await settle();
    expect((await reload(appointment)).status).toBe('pending_approval');

    await postWebhook(webhookBody([message], { phoneNumberId: '1234567890' }));
    expect((await reload(appointment)).status).toBe('confirmed');
  });
});

describe('each clinic on its own', () => {
  it('acts on the clinic of the button, even when the same number is a patient in two clinics', async () => {
    const clinicA = await createClinic({ name: 'Consultorio A' });
    const clinicB = await createClinic({ name: 'Consultorio B' });
    const a = await book({ clinic: clinicA });
    const b = await book({ clinic: clinicB });
    await createUser({ role: 'admin', clinic: clinicB });

    await tap('cancel', a.appointment, FROM);
    await answered();

    expect((await reload(a.appointment)).status).toBe('cancelled');
    expect((await reload(b.appointment)).status).toBe('pending_approval');
    expect(await history(b.appointment)).toEqual([]);
    const entries = await audits();
    expect(entries.map((entry) => entry.clinicId)).toEqual([clinicA.id]);
    expect(answers()).toHaveLength(1);

    await tap('confirm', b.appointment, FROM);
    expect((await reload(b.appointment)).status).toBe('confirmed');
    expect((await reload(a.appointment)).status).toBe('cancelled');
  });

  it('shows what happened only to the clinic it happened in, in the audit log and in the visit\'s history', async () => {
    const clinicA = await createClinic();
    const clinicB = await createClinic();
    const { appointment, doctor } = await book({ clinic: clinicA });
    const adminA = await createUser({ role: 'admin', clinic: clinicA });
    const adminB = await createUser({ role: 'admin', clinic: clinicB });
    const doctorToken = (await createUser({ role: 'doctor', clinic: clinicA })).token;

    await tap('confirm', appointment, FROM);

    const auditA = await request(app).get('/api/admin/audit-log').query({ entity: 'appointment' }).set(bearer(adminA.token));
    const auditB = await request(app).get('/api/admin/audit-log').query({ entity: 'appointment' }).set(bearer(adminB.token));
    expect(auditA.body.entries).toHaveLength(1);
    expect(auditA.body.entries[0]).toMatchObject({ actor: { name: 'Patient (WhatsApp)', role: 'patient' }, action: 'update', entityId: appointment.id, changes: { status: { from: 'pending_approval', to: 'confirmed' } } });
    expect(auditB.body.entries).toEqual([]);

    const own = await request(app).get(`/api/appointments/${appointment.id}/notifications`).set(bearer(adminA.token));
    expect(own.body.notifications.map((n) => [n.kind, n.status])).toContainEqual(['patient_confirmed', 'received']);
    const foreign = await request(app).get(`/api/appointments/${appointment.id}/notifications`).set(bearer(adminB.token));
    expect(foreign.status).toBe(404);
    // A doctor who is not the visit's own does not see it either
    const sibling = await request(app).get(`/api/appointments/${appointment.id}/notifications`).set(bearer(doctorToken));
    expect(sibling.status).toBe(404);
    expect(doctor.id).not.toBe(adminA.user.id);
  });

  it('does not count what patients write as a delivery failure of the clinic', async () => {
    const { appointment } = await book();

    await tap('confirm', appointment, FROM);
    await answered();

    const status = await notificationLog.channelStatus(appointment.clinicId);
    expect(status.channels.whatsapp).toMatchObject({ failing: false, failedInARow: 0, lastSentAt: null });
  });
});

describe('Meta sending the same thing again', () => {
  it('recognises a message it already handled by its id: nothing new is changed, recorded, sent or audited', async () => {
    const { appointment } = await book();
    await createUser({ role: 'admin' });

    await tap('confirm', appointment, FROM, { id: 'wamid.same' });
    await answered();
    const second = await tap('confirm', appointment, FROM, { id: 'wamid.same' });
    await settle();

    expect(second.status).toBe(200);
    expect(answers()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
    expect((await received(appointment)).map((row) => row.kind)).toEqual(['patient_confirmed']);
  });

  it('recognises a repeated «Cambiar hora» by its id too: one email round only', async () => {
    const { appointment } = await book();
    await createUser({ role: 'admin' });

    await tap('reschedule', appointment, FROM, { id: 'wamid.again' });
    await waitFor(() => sendEmail.mock.calls.length >= 1);
    await tap('reschedule', appointment, FROM, { id: 'wamid.again' });
    await settle();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(answers()).toHaveLength(1);
  });

  it('answers 500 when it could not save, so Meta tries again, and handles the retry normally', async () => {
    const { appointment } = await book();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('connection lost'));

    const first = await tap('confirm', appointment, FROM, { id: 'wamid.retry' });
    expect(first.status).toBe(500);
    expect(first.body).toEqual({ error: 'Could not process every message' });
    expect((await reload(appointment)).status).toBe('pending_approval');
    expect(sendWhatsApp).not.toHaveBeenCalled();

    const retry = await tap('confirm', appointment, FROM, { id: 'wamid.retry' });
    await answered();

    expect(retry.status).toBe(200);
    expect((await reload(appointment)).status).toBe('confirmed');
    expect(answers()).toHaveLength(1);
  });

  it('keeps what it saved from a call with several messages when one of them fails, and answers 500 for Meta to resend', async () => {
    const first = await book();
    const second = await book({ phone: '+593990000077' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const real = prisma.$transaction.bind(prisma);
    jest.spyOn(prisma, '$transaction')
      .mockImplementationOnce(real)
      .mockRejectedValueOnce(new Error('connection lost'));
    const messages = [
      buttonMessage({ from: FROM, payload: buttonPayload('confirm', first.appointment), id: 'wamid.m1' }),
      buttonMessage({ from: '593990000077', payload: buttonPayload('confirm', second.appointment), id: 'wamid.m2' })
    ];

    const res = await postWebhook(webhookBody(messages));
    await answered();

    expect(res.status).toBe(500);
    expect((await reload(first.appointment)).status).toBe('confirmed');
    expect((await reload(second.appointment)).status).toBe('pending_approval');

    const retry = await postWebhook(webhookBody(messages));
    await answered(2);

    expect(retry.status).toBe(200);
    expect((await reload(second.appointment)).status).toBe('confirmed');
    expect(answers()).toHaveLength(2); // the first message was not answered twice
    expect(await audits()).toHaveLength(2);
  });

  it('handles every message of one call', async () => {
    const first = await book();
    const second = await book({ phone: '+593990000077' });

    const res = await postWebhook(webhookBody([
      buttonMessage({ from: FROM, payload: buttonPayload('confirm', first.appointment) }),
      buttonMessage({ from: '593990000077', payload: buttonPayload('cancel', second.appointment) })
    ]));
    await answered(2);

    expect(res.status).toBe(200);
    expect((await reload(first.appointment)).status).toBe('confirmed');
    expect((await reload(second.appointment)).status).toBe('cancelled');
  });

  it('still saves the decision, and answers 200, when the answer to the patient cannot be sent', async () => {
    const { appointment } = await book();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    sendWhatsApp.mockRejectedValueOnce(new Error('Meta is down'));

    const res = await tap('confirm', appointment, FROM);
    await answered();
    await settle();

    expect(res.status).toBe(200);
    expect((await reload(appointment)).status).toBe('confirmed');
    expect((await received(appointment)).map((row) => row.kind)).toEqual(['patient_confirmed']);
  });
});
