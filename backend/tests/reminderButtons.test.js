const notificationService = require('../src/services/notificationService');
const { buildTemplate, TEMPLATES } = require('../src/services/whatsappTemplates');
const { BUTTONS, buttonPayload, parseButtonPayload, stampOf } = require('../src/services/whatsappButtons');

const ID = '0b9f3a52-6c1e-4f0a-9d54-3a1c2b7e8f10';
const visit = { id: ID, date: '2030-01-15', time: '10:00' };

describe('the payload of a button', () => {
  it('names the visit and the action, and reads back as the same', () => {
    expect(BUTTONS.map(({ action }) => parseButtonPayload(buttonPayload(action, visit)))).toEqual([
      { action: 'confirm', appointmentId: ID, stamp: '203001151000' },
      { action: 'cancel', appointmentId: ID, stamp: '203001151000' },
      { action: 'reschedule', appointmentId: ID, stamp: '203001151000' }
    ]);
  });

  it('fits in the 128 characters Meta allows, and the labels in the 25 of a button', () => {
    for (const { action, label } of BUTTONS) {
      expect(buttonPayload(action, visit).length).toBeLessThanOrEqual(128);
      expect(label.length).toBeLessThanOrEqual(25);
    }
    expect(BUTTONS.map(({ label }) => label)).toEqual(['Confirmo', 'Cancelar', 'Cambiar hora']);
  });

  it('is different for each action and for each visit', () => {
    const payloads = new Set([
      ...BUTTONS.map(({ action }) => buttonPayload(action, visit)),
      buttonPayload('confirm', { ...visit, time: '10:30' }),
      buttonPayload('confirm', { ...visit, id: '1b9f3a52-6c1e-4f0a-9d54-3a1c2b7e8f10' })
    ]);
    expect(payloads.size).toBe(5);
  });

  it('is the same every time for the same visit (a reminder sent twice carries the same buttons)', () => {
    expect(buttonPayload('cancel', visit)).toBe(buttonPayload('cancel', visit));
  });

  it('carries no name, phone or note, only the id and the time of the visit', () => {
    expect(buttonPayload('cancel', visit)).toMatch(/^x\.[0-9a-f-]{36}\.203001151000\.[\w-]{22}$/);
  });

  it('is refused when any part is changed, cut or made up', () => {
    const payload = buttonPayload('cancel', visit);
    const [code, id, stamp, signature] = payload.split('.');
    const forged = [
      `c.${id}.${stamp}.${signature}`, // another action with the old signature
      `${code}.${id.replace(/^0/, '1')}.${stamp}.${signature}`, // another appointment
      `${code}.${id}.203001151030.${signature}`, // another time
      `${code}.${id}.${stamp}.${signature.replace(/.$/, signature.endsWith('A') ? 'B' : 'A')}`, // another signature
      payload.slice(0, -1),
      `${payload}x`,
      ` ${payload}`,
      payload.toUpperCase(),
      'Confirmo',
      '',
      null,
      undefined,
      42,
      { payload }
    ];
    for (const attempt of forged) expect(parseButtonPayload(attempt)).toBeNull();
  });

  it('is refused when it was signed with another secret', () => {
    const payload = buttonPayload('cancel', visit);
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'another-secret-0123456789-abcdefghijklmnopqrstuv';
    try {
      expect(parseButtonPayload(payload)).toBeNull();
    } finally {
      process.env.JWT_SECRET = original;
    }
  });

  it('writes the date and time of the visit as twelve digits', () => {
    expect(stampOf('2030-01-15', '10:00')).toBe('203001151000');
    expect(stampOf('2031-12-01', '08:05')).toBe('203112010805');
  });

  it('does not make a payload for an action that does not exist', () => {
    expect(() => buttonPayload('refund', visit)).toThrow('Unknown WhatsApp button "refund"');
  });
});

describe('the reminder templates with buttons', () => {
  it('say how to answer, and keep the order and meaning of the variables of the ones without', () => {
    const plain = TEMPLATES.appointmentReminder;
    const withButtons = TEMPLATES.appointmentReminderButtons;
    const detailed = TEMPLATES.appointmentReminderDetailed;
    const detailedWithButtons = TEMPLATES.appointmentReminderDetailedButtons;

    expect(withButtons).toMatchObject({ nameEnvVar: 'META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS', defaultName: 'recordatorio_cita_botones', fields: plain.fields, buttons: true });
    expect(detailedWithButtons).toMatchObject({ nameEnvVar: 'META_WHATSAPP_TEMPLATE_REMINDER_DETAILED_BUTTONS', defaultName: 'recordatorio_cita_consultorio_botones', fields: detailed.fields, buttons: true });
    expect(withButtons.body).toContain('Toca uno de los botones para confirmar, cancelar o pedir otro horario');
    // Meta wants no variable at the very start or end of the text
    for (const template of [withButtons, detailedWithButtons]) {
      expect(template.body).not.toMatch(/^\{\{|\}\}$/);
    }
    expect(plain.buttons).toBeUndefined();
    expect(detailed.buttons).toBeUndefined();
  });

  it('give each button the payload of the visit being reminded', () => {
    const t = buildTemplate('appointmentReminderButtons', { patientName: 'María', whenText: 'mañana 2030-01-15', time: '10:00', doctorName: 'Dr. Pérez', appointment: visit }, {});

    expect(t.name).toBe('recordatorio_cita_botones');
    expect(t.params).toEqual(['María', 'mañana 2030-01-15', '10:00', 'Dr. Pérez']);
    expect(t.buttons.map(({ action, label }) => [action, label])).toEqual([['confirm', 'Confirmo'], ['cancel', 'Cancelar'], ['reschedule', 'Cambiar hora']]);
    expect(t.buttons.map((button) => parseButtonPayload(button.payload).action)).toEqual(['confirm', 'cancel', 'reschedule']);
  });

  it('have no payload without a visit (a preview), and a template without buttons has none at all', () => {
    expect(buildTemplate('appointmentReminderButtons', {}, {}).buttons.map((button) => button.payload)).toEqual([null, null, null]);
    expect(buildTemplate('appointmentReminder', { appointment: visit }, {}).buttons).toEqual([]);
  });
});

describe('which reminder Meta sends', () => {
  const META = { META_WHATSAPP_TOKEN: 'token', META_WHATSAPP_PHONE_NUMBER_ID: '1234567890' };
  const clinic = { name: 'Consultorio Torres', address: 'Av. Amazonas N34-12', reminderIndications: null, reminderWhatsapp: true, reminderEmail: false };
  const bare = { ...clinic, address: null };
  const appointment = { id: ID, clinicId: 'c1', date: '2030-01-15', time: '10:00', patient: { name: 'María Andrade', phone: '+593990000042', email: null }, doctor: { name: 'Dra. Camila Torres' } };

  let saved;
  beforeEach(() => {
    saved = { ...process.env };
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', META_WHATSAPP_TEMPLATE_REMINDER_DETAILED: '', META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS: '', META_WHATSAPP_TEMPLATE_REMINDER_DETAILED_BUTTONS: '', META_APP_SECRET: '' });
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => '{}' });
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    jest.restoreAllMocks();
  });

  const setEnv = (vars) => Object.assign(process.env, vars);
  const sent = async (forClinic) => {
    global.fetch.mockClear();
    await notificationService.sendReminder(appointment, { dayLabel: 'mañana', clinic: forClinic });
    return JSON.parse(global.fetch.mock.calls[0][1].body);
  };
  const buttonsOf = (body) => body.template.components.filter((component) => component.type === 'button');

  it('is the plain reminder, with no buttons, until both the template and the webhook are set up', async () => {
    setEnv(META);
    expect((await sent(bare)).template.name).toBe('recordatorio_cita');

    setEnv({ META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS: 'recordatorio_cita_botones' }); // approved, but nobody could answer it
    const body = await sent(bare);
    expect(body.template.name).toBe('recordatorio_cita');
    expect(buttonsOf(body)).toEqual([]);

    setEnv({ META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS: '', META_APP_SECRET: 'secret' }); // the webhook is ready, the template is not
    expect((await sent(bare)).template.name).toBe('recordatorio_cita');
  });

  it('sends the template with buttons once it is registered and the webhook is ready, a payload in each button', async () => {
    setEnv({ ...META, META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS: 'recordatorio_cita_botones', META_APP_SECRET: 'secret' });

    const body = await sent(bare);

    expect(body.template.name).toBe('recordatorio_cita_botones');
    expect(body.template.components[0]).toEqual({ type: 'body', parameters: ['María Andrade', 'mañana 2030-01-15', '10:00', 'Dra. Camila Torres'].map((text) => ({ type: 'text', text })) });
    expect(buttonsOf(body).map(({ type, sub_type, index }) => [type, sub_type, index])).toEqual([['button', 'quick_reply', '0'], ['button', 'quick_reply', '1'], ['button', 'quick_reply', '2']]);
    const payloads = buttonsOf(body).map((component) => {
      expect(component.parameters).toEqual([{ type: 'payload', payload: expect.any(String) }]);
      return parseButtonPayload(component.parameters[0].payload);
    });
    expect(payloads).toEqual([
      { action: 'confirm', appointmentId: ID, stamp: '203001151000' },
      { action: 'cancel', appointmentId: ID, stamp: '203001151000' },
      { action: 'reschedule', appointmentId: ID, stamp: '203001151000' }
    ]);
  });

  it('picks the detailed template with buttons for a clinic with an address, when it is registered', async () => {
    setEnv({ ...META, META_APP_SECRET: 'secret', META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS: 'recordatorio_cita_botones', META_WHATSAPP_TEMPLATE_REMINDER_DETAILED_BUTTONS: 'recordatorio_cita_consultorio_botones' });

    const body = await sent(clinic);

    expect(body.template.name).toBe('recordatorio_cita_consultorio_botones');
    expect(body.template.components[0].parameters).toHaveLength(6);
    expect(buttonsOf(body)).toHaveLength(3);
  });

  it('prefers the buttons to the details when only the plain buttons template exists (the details go in the email)', async () => {
    setEnv({ ...META, META_APP_SECRET: 'secret', META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS: 'recordatorio_cita_botones', META_WHATSAPP_TEMPLATE_REMINDER_DETAILED: 'recordatorio_cita_consultorio' });

    const body = await sent(clinic);

    expect(body.template.name).toBe('recordatorio_cita_botones');
    expect(buttonsOf(body)).toHaveLength(3);
  });

  it('keeps sending the detailed template without buttons while the buttons are not ready', async () => {
    setEnv({ ...META, META_WHATSAPP_TEMPLATE_REMINDER_DETAILED: 'recordatorio_cita_consultorio' });

    const body = await sent(clinic);

    expect(body.template.name).toBe('recordatorio_cita_consultorio');
    expect(buttonsOf(body)).toEqual([]);
  });

  it('uses the plain buttons template for a clinic with no details even when the detailed one with buttons exists', async () => {
    setEnv({ ...META, META_APP_SECRET: 'secret', META_WHATSAPP_TEMPLATE_REMINDER_DETAILED_BUTTONS: 'recordatorio_cita_consultorio_botones' });

    expect((await sent(bare)).template.name).toBe('recordatorio_cita');
  });

  it('sends free text, with no buttons, through Twilio and the mock, whatever is registered in Meta', async () => {
    setEnv({ META_APP_SECRET: 'secret', META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS: 'recordatorio_cita_botones', META_WHATSAPP_TOKEN: '', META_WHATSAPP_PHONE_NUMBER_ID: '' });

    expect(await notificationService.sendReminder(appointment, { dayLabel: 'mañana', clinic })).toBe(true);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows the buttons in the preview of the settings screen only when they would be sent', () => {
    setEnv(META);
    expect(notificationService.reminderPreview(bare, { whenText: 'mañana 2030-01-15' })).toMatchObject({ template: 'recordatorio_cita', buttons: [] });

    setEnv({ META_APP_SECRET: 'secret', META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS: 'recordatorio_cita_botones' });
    expect(notificationService.reminderPreview(bare, { whenText: 'mañana 2030-01-15' })).toMatchObject({
      template: 'recordatorio_cita_botones',
      buttons: ['Confirmo', 'Cancelar', 'Cambiar hora'],
      detailsInWhatsapp: false
    });
    expect(notificationService.reminderPreview(clinic, { whenText: 'mañana 2030-01-15' })).toMatchObject({ template: 'recordatorio_cita_botones', detailsInWhatsapp: false });

    setEnv({ META_WHATSAPP_TEMPLATE_REMINDER_DETAILED_BUTTONS: 'recordatorio_cita_consultorio_botones' });
    expect(notificationService.reminderPreview(clinic, { whenText: 'mañana 2030-01-15' })).toMatchObject({ template: 'recordatorio_cita_consultorio_botones', detailsInWhatsapp: true });
  });
});
