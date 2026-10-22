const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { validateChange, detailsOf, monthlyUsage } = require('../src/services/reminderSettings');
const { clinicDateString } = require('../src/utils/clinicTime');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const read = (token) => request(app).get('/api/admin/reminder-settings').set(bearer(token));
const change = (token, body) => request(app).put('/api/admin/reminder-settings').set(bearer(token)).send(body);

const DEFAULTS = { reminderEnabled: true, reminderHours: 24, secondReminderHours: null, reminderWhatsapp: true, reminderEmail: true, address: null, reminderIndications: null };

describe('validateChange', () => {
  it('turns what was sent into columns of the clinic', () => {
    const { data } = validateChange({ enabled: false, hours: 48, secondHours: 2, whatsapp: true, email: false, address: ' Av. Amazonas  N34-12 ', indications: 'Llegar\n10 minutos antes' }, DEFAULTS);

    expect(data).toEqual({
      reminderEnabled: false,
      reminderHours: 48,
      secondReminderHours: 2,
      reminderWhatsapp: true,
      reminderEmail: false,
      address: 'Av. Amazonas N34-12',
      reminderIndications: 'Llegar 10 minutos antes'
    });
  });

  it('empties the address or the indications when they are sent blank or null', () => {
    expect(validateChange({ address: '   ', indications: null }, { ...DEFAULTS, address: 'x' }).data).toEqual({ address: null, reminderIndications: null });
  });

  it.each([
    ['nothing to change', {}, /Send at least one of/],
    ['a flag that is not a boolean', { enabled: 'yes' }, /enabled must be true or false/],
    ['hours that are not offered', { hours: 12 }, /hours must be one of: 2, 24, 48/],
    ['hours that are text', { hours: '24' }, /hours must be one of/],
    ['second hours that are not offered', { secondHours: 5 }, /secondHours must be null or one of/],
    ['a second reminder as far as the first', { secondHours: 24 }, /must be closer to the appointment/],
    ['a second reminder farther than the first', { secondHours: 48 }, /must be closer to the appointment/],
    ['both channels off while enabled', { whatsapp: false, email: false }, /at least one channel/],
    ['an address that is not text', { address: 5 }, /address must be text/],
    ['an address that is too long', { address: 'x'.repeat(151) }, /address must be at most 150/],
    ['indications that are too long', { indications: 'x'.repeat(201) }, /indications must be at most 200/]
  ])('rejects %s', (_label, body, message) => {
    expect(validateChange(body, DEFAULTS).error).toMatch(message);
  });

  it('judges the result, not only what was sent', () => {
    // moving the first reminder to 2 hours leaves the existing second one (24 h) farther than it
    expect(validateChange({ hours: 2 }, { ...DEFAULTS, secondReminderHours: 24 }).error).toMatch(/closer to the appointment/);
    // turning WhatsApp off is fine while email is on, and not when it was the other way round
    expect(validateChange({ whatsapp: false }, DEFAULTS).data).toEqual({ reminderWhatsapp: false });
    expect(validateChange({ email: false }, { ...DEFAULTS, reminderWhatsapp: false }).error).toMatch(/at least one channel/);
    // with the reminders off, no channel is needed
    expect(validateChange({ enabled: false, whatsapp: false, email: false }, DEFAULTS).data).toMatchObject({ reminderEnabled: false });
  });
});

describe('detailsOf', () => {
  it('joins the address and the indications into one line, or says nothing', () => {
    expect(detailsOf({ address: 'Av. Amazonas N34-12.', reminderIndications: 'Llegar 10 minutos antes' })).toBe('Av. Amazonas N34-12. Llegar 10 minutos antes');
    expect(detailsOf({ address: 'Av. Amazonas N34-12', reminderIndications: null })).toBe('Av. Amazonas N34-12');
    expect(detailsOf({ address: null, reminderIndications: 'Traer la cédula' })).toBe('Traer la cédula');
    expect(detailsOf({ address: null, reminderIndications: null })).toBe('');
  });
});

describe('GET /api/admin/reminder-settings', () => {
  it('shows a clinic that never touched them with what it always did: on, 24 hours, both channels', async () => {
    const admin = await createUser({ role: 'admin' });

    const res = await read(admin.token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, hours: 24, secondHours: null, whatsapp: true, email: true, address: null, indications: null });
    expect(res.body.options).toEqual({ hours: [2, 24, 48] });
  });

  it('shows how the reminder would look for the patient, with the clinic\'s details', async () => {
    const clinic = await createClinic({ name: 'Consultorio Torres', address: 'Av. Amazonas N34-12', reminderIndications: 'Traer la cédula' });
    const admin = await createUser({ role: 'admin', clinic });

    const res = await read(admin.token);

    // with no Meta credentials (tests) the detailed text is plain free text, so it carries the details
    expect(res.body.preview.template).toBe('recordatorio_cita_consultorio');
    expect(res.body.preview.detailsInWhatsapp).toBe(true);
    expect(res.body.preview.text).toContain('Recordatorio de Consultorio Torres: Hola María Andrade, tienes una cita mañana ');
    expect(res.body.preview.text).toContain('Dónde y cómo llegar: Av. Amazonas N34-12. Traer la cédula.');
  });

  it('shows the plain reminder for a clinic with no details', async () => {
    const admin = await createUser({ role: 'admin' });

    const { preview } = (await read(admin.token)).body;

    expect(preview).toMatchObject({ template: 'recordatorio_cita', detailsInWhatsapp: false });
    expect(preview.text).toMatch(/^Recordatorio MedCita: Hola María Andrade/);
  });

  describe('with Meta as the provider', () => {
    let saved;
    beforeEach(() => {
      saved = { ...process.env };
      Object.assign(process.env, { META_WHATSAPP_TOKEN: 'token', META_WHATSAPP_PHONE_NUMBER_ID: '123', META_WHATSAPP_TEMPLATE_REMINDER_DETAILED: '' });
    });
    afterEach(() => {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    });

    it('keeps to the approved template until the detailed one is registered, and says the details go by email', async () => {
      const admin = await createUser({ role: 'admin', clinic: await createClinic({ address: 'Av. Amazonas N34-12' }) });

      const before = (await read(admin.token)).body.preview;
      process.env.META_WHATSAPP_TEMPLATE_REMINDER_DETAILED = 'recordatorio_cita_consultorio';
      const after = (await read(admin.token)).body.preview;

      expect(before).toMatchObject({ template: 'recordatorio_cita', detailsInWhatsapp: false });
      expect(after).toMatchObject({ template: 'recordatorio_cita_consultorio', detailsInWhatsapp: true });
    });
  });

  it('counts this month\'s messages that really left, WhatsApp and email, and how many were reminders', async () => {
    const admin = await createUser({ role: 'admin' });
    const clinicId = admin.user.clinicId;
    const log = (channel, kind, status = 'sent', extra = {}) =>
      prisma.notificationLog.create({ data: { clinicId, channel, kind, provider: 'meta', recipient: 'patient', status, destination: '+593***042', ...extra } });
    await log('whatsapp', 'appointment_confirmation');
    await log('whatsapp', 'appointment_reminder');
    await log('whatsapp', 'appointment_second_reminder');
    await log('whatsapp', 'appointment_reminder', 'failed'); // did not leave
    await log('whatsapp', 'appointment_reminder', 'simulated'); // nothing real left either
    await log('email', 'appointment_reminder');
    await log('email', 'doctor_new_appointment');
    await log('whatsapp', 'appointment_reminder', 'sent', { createdAt: new Date('2020-01-15T12:00:00Z') }); // another month
    const other = await createClinic();
    await prisma.notificationLog.create({ data: { clinicId: other.id, channel: 'whatsapp', kind: 'appointment_reminder', provider: 'meta', recipient: 'patient', status: 'sent', destination: 'x' } });

    const { usage } = (await read(admin.token)).body;

    expect(usage).toEqual({
      month: clinicDateString(new Date(), 'America/Guayaquil').slice(0, 7),
      whatsapp: { total: 3, reminders: 2 },
      email: { total: 2, reminders: 1 }
    });
  });

  it('counts the month by the clinic\'s own calendar', async () => {
    const clinic = await createClinic({ timezone: 'Asia/Tokyo' });
    const log = (createdAt) =>
      prisma.notificationLog.create({ data: { clinicId: clinic.id, channel: 'whatsapp', kind: 'appointment_reminder', provider: 'meta', recipient: 'patient', status: 'sent', destination: 'x', createdAt } });
    await log(new Date('2030-02-28T16:00:00Z')); // 01:00 on 1 March in Tokyo
    await log(new Date('2030-02-28T14:00:00Z')); // 23:00 on 28 February in Tokyo

    const usage = await monthlyUsage(prisma, { id: clinic.id, timezone: 'Asia/Tokyo' }, new Date('2030-03-10T00:00:00Z'));

    expect(usage.month).toBe('2030-03');
    expect(usage.whatsapp.total).toBe(1);
  });

  it('is for admins only', async () => {
    const { user } = await createUser({ role: 'admin' });
    for (const role of ['doctor', 'secretary']) {
      const who = await createUser({ role, clinic: { id: user.clinicId } });
      expect((await read(who.token)).status).toBe(403);
      expect((await change(who.token, { enabled: false })).status).toBe(403);
    }
    expect((await request(app).get('/api/admin/reminder-settings')).status).toBe(401);
    expect((await request(app).put('/api/admin/reminder-settings').send({ enabled: false })).status).toBe(401);
  });
});

describe('PUT /api/admin/reminder-settings', () => {
  it('saves the settings of the admin\'s own clinic only, and answers with them', async () => {
    const admin = await createUser({ role: 'admin' });
    const other = await createClinic();

    const res = await change(admin.token, { hours: 48, secondHours: 2, email: false, address: 'Av. Amazonas N34-12', indications: 'Llegar 10 minutos antes' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, hours: 48, secondHours: 2, whatsapp: true, email: false, address: 'Av. Amazonas N34-12', indications: 'Llegar 10 minutos antes' });
    expect(res.body.preview.text).toContain('Av. Amazonas N34-12. Llegar 10 minutos antes');
    expect(await prisma.clinic.findUnique({ where: { id: admin.user.clinicId }, select: { reminderHours: true, secondReminderHours: true, reminderEmail: true } }))
      .toEqual({ reminderHours: 48, secondReminderHours: 2, reminderEmail: false });
    expect(await prisma.clinic.findUnique({ where: { id: other.id }, select: { reminderHours: true, reminderEmail: true, address: true } }))
      .toEqual({ reminderHours: 24, reminderEmail: true, address: null });
  });

  it('can clear the second reminder again, and turn everything off', async () => {
    const admin = await createUser({ role: 'admin', clinic: await createClinic({ secondReminderHours: 2 }) });

    const off = await change(admin.token, { secondHours: null });
    const none = await change(admin.token, { enabled: false });

    expect(off.body.secondHours).toBeNull();
    expect(none.body.enabled).toBe(false);
  });

  it('refuses a change that makes no sense and keeps what was there', async () => {
    const admin = await createUser({ role: 'admin' });

    for (const body of [{ hours: 12 }, { hours: 2, secondHours: 24 }, { whatsapp: false, email: false }, {}]) {
      expect((await change(admin.token, body)).status).toBe(400);
    }
    expect((await change(admin.token, { secondHours: 2, hours: 2 })).body.error).toMatch(/closer to the appointment/);
    expect(await prisma.clinic.findUnique({ where: { id: admin.user.clinicId }, select: { reminderHours: true, secondReminderHours: true } })).toEqual({ reminderHours: 24, secondReminderHours: null });
  });

  it('records what changed in the audit log, without the address or the indications', async () => {
    const admin = await createUser({ role: 'admin' });

    await change(admin.token, { hours: 48, address: 'Calle Secreta 123', indications: 'Tocar el timbre del fondo' });

    const entry = await prisma.auditLog.findFirst({ where: { entity: 'reminder_settings' } });
    expect(entry).toMatchObject({ action: 'update', actorId: admin.user.id, entityId: admin.user.clinicId, clinicId: admin.user.clinicId });
    expect(entry.changes).toEqual({ reminderHours: { from: 24, to: 48 }, address: { changed: true }, reminderIndications: { changed: true } });
    expect(JSON.stringify(entry)).not.toMatch(/Secreta|timbre/);
  });

  it('leaves no record when nothing really changed', async () => {
    const admin = await createUser({ role: 'admin' });

    expect((await change(admin.token, { hours: 24, enabled: true })).status).toBe(200);

    expect(await prisma.auditLog.count({ where: { entity: 'reminder_settings' } })).toBe(0);
  });

  it('is part of the audit log filter', async () => {
    const admin = await createUser({ role: 'admin' });
    await change(admin.token, { hours: 2 });

    const res = await request(app).get('/api/admin/audit-log?entity=reminder_settings').set(bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
  });
});

describe('the "reminder pending" note of an appointment', () => {
  const pending = async (admin, apt) =>
    (await request(app).get(`/api/appointments/${apt.id}/notifications`).set(bearer(admin.token))).body.reminderPending;

  it('says the reminder is still owed, unless the clinic turned its reminders off', async () => {
    const admin = await createUser({ role: 'admin' });
    const doctor = await createUser({ clinic: { id: admin.user.clinicId } });
    const patient = await createPatient({ clinic: { id: admin.user.clinicId } });
    const apt = await createAppointment({ doctor: doctor.user, patient, date: '2030-01-14', time: '09:00', status: 'confirmed' });

    expect(await pending(admin, apt)).toBe(true);
    await change(admin.token, { enabled: false });
    expect(await pending(admin, apt)).toBe(false);
  });
});
