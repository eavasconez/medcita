const mockTwilioCreate = jest.fn();
jest.mock('twilio', () => jest.fn(() => ({ messages: { create: mockTwilioCreate } })));

const notificationService = require('../src/services/notificationService');
const { buildTemplate, TEMPLATES } = require('../src/services/whatsappTemplates');

const META_ENV = {
  META_WHATSAPP_TOKEN: 'test-token',
  META_WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  META_WHATSAPP_TEMPLATE_CONFIRMATION: '',
  META_WHATSAPP_TEMPLATE_REMINDER: '',
  META_WHATSAPP_TEMPLATE_LANGUAGE: ''
};
const TWILIO_ENV = { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'test', TWILIO_WHATSAPP_NUMBER: '+14155238886' };

const appointment = {
  date: '2030-01-15',
  time: '10:00',
  patient: { name: 'María Andrade', phone: '+593990000042', email: null },
  doctor: { name: 'Dra. Camila Torres', email: null }
};

let saved;
const setEnv = (vars) => Object.assign(process.env, vars);
beforeEach(() => {
  saved = { ...process.env };
  setEnv({ META_WHATSAPP_TOKEN: '', META_WHATSAPP_PHONE_NUMBER_ID: '', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '' });
  mockTwilioCreate.mockReset().mockResolvedValue({ sid: 'SM1' });
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => '{}' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  jest.restoreAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

const sentBody = () => JSON.parse(global.fetch.mock.calls[0][1].body);

describe('buildTemplate', () => {
  it('fills the confirmation in the order of its {{n}} variables', () => {
    const t = buildTemplate('appointmentConfirmation', { patientName: 'María', doctorName: 'Dr. Pérez', date: '2030-01-15', time: '10:00' }, {});

    expect(t).toMatchObject({ key: 'appointmentConfirmation', name: 'cita_confirmada', language: 'es' });
    expect(t.params).toEqual(['María', 'Dr. Pérez', '2030-01-15', '10:00']);
    expect(t.text).toBe('MedCita: Hola María, tu cita con Dr. Pérez ha sido agendada para el 2030-01-15 a las 10:00. ¡Te esperamos!');
  });

  it('fills the reminder, with the day label as its own variable', () => {
    const t = buildTemplate('appointmentReminder', { patientName: 'María', dayLabel: 'mañana', date: '2030-01-15', time: '10:00', doctorName: 'Dr. Pérez' }, {});

    expect(t.name).toBe('recordatorio_cita');
    expect(t.params).toEqual(['María', 'mañana', '2030-01-15', '10:00', 'Dr. Pérez']);
    expect(t.text).toBe('Recordatorio MedCita: Hola María, tienes una cita mañana 2030-01-15 a las 10:00 con Dr. Pérez.');
  });

  it('uses the template name and language from the environment when they are set', () => {
    const env = { META_WHATSAPP_TEMPLATE_CONFIRMATION: 'mi_confirmacion', META_WHATSAPP_TEMPLATE_LANGUAGE: 'es_MX' };

    const t = buildTemplate('appointmentConfirmation', {}, env);

    expect(t).toMatchObject({ name: 'mi_confirmacion', language: 'es_MX' });
  });

  it('cleans what Meta rejects in a parameter: line breaks, tabs, long runs of spaces, empty values', () => {
    const t = buildTemplate('appointmentConfirmation', { patientName: ' María\n  Andrade\t', doctorName: '', date: undefined, time: '10:00' }, {});

    expect(t.params).toEqual(['María Andrade', '-', '-', '10:00']);
    expect(t.text).not.toMatch(/[\n\t]/);
  });

  it('cuts a parameter at the 1024 characters Meta allows', () => {
    const t = buildTemplate('appointmentConfirmation', { patientName: 'x'.repeat(5000) }, {});

    expect(t.params[0]).toHaveLength(1024);
  });

  it('refuses a template that does not exist', () => {
    expect(() => buildTemplate('birthday', {}, {})).toThrow(/Unknown WhatsApp template/);
  });

  it('only uses variables that its fields fill, and has no gaps in the numbering', () => {
    for (const template of Object.values(TEMPLATES)) {
      const used = [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(used).toEqual(template.fields.map((_, i) => i + 1));
    }
  });
});

describe('sendWhatsApp through Meta', () => {
  beforeEach(() => setEnv(META_ENV));

  it('sends the confirmation as an approved template, not as free text', async () => {
    const ok = await notificationService.sendAppointmentConfirmation(appointment).then(() => true);

    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(sentBody()).toEqual({
      messaging_product: 'whatsapp',
      to: '593990000042',
      type: 'template',
      template: {
        name: 'cita_confirmada',
        language: { code: 'es' },
        components: [{
          type: 'body',
          parameters: ['María Andrade', 'Dra. Camila Torres', '2030-01-15', '10:00'].map((text) => ({ type: 'text', text }))
        }]
      }
    });
  });

  it.each([['hoy'], ['mañana']])('sends the reminder as a template with "%s" as its day', async (dayLabel) => {
    const delivered = await notificationService.sendReminder(appointment, { dayLabel });

    expect(delivered).toBe(true);
    expect(sentBody().type).toBe('template');
    expect(sentBody().template.name).toBe('recordatorio_cita');
    expect(sentBody().template.components[0].parameters.map((p) => p.text)).toEqual(['María Andrade', dayLabel, '2030-01-15', '10:00', 'Dra. Camila Torres']);
  });

  it('uses the template names and language configured in the environment', async () => {
    setEnv({ META_WHATSAPP_TEMPLATE_CONFIRMATION: 'mi_confirmacion', META_WHATSAPP_TEMPLATE_LANGUAGE: 'es_MX' });

    await notificationService.sendAppointmentConfirmation(appointment);

    expect(sentBody().template).toMatchObject({ name: 'mi_confirmacion', language: { code: 'es_MX' } });
  });

  it('keeps plain text for a caller that has no template', async () => {
    await notificationService.sendWhatsApp('+593990000042', 'Hola');

    expect(sentBody()).toEqual({ messaging_product: 'whatsapp', to: '593990000042', type: 'text', text: { preview_url: false, body: 'Hola' } });
  });

  it('answers false, without throwing, when Meta refuses the message', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":{"code":132001}}' });

    const delivered = await notificationService.sendReminder(appointment);

    expect(delivered).toBe(false);
  });

  it('answers false, without throwing, when the request itself fails', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));

    const delivered = await notificationService.sendReminder(appointment);

    expect(delivered).toBe(false);
  });

  it('does not fall back to Twilio when Meta is configured but fails', async () => {
    setEnv(TWILIO_ENV);
    global.fetch.mockResolvedValue({ ok: false, status: 400, text: async () => '{}' });

    await notificationService.sendReminder(appointment);

    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });
});

describe('without Meta credentials', () => {
  it('uses Twilio with the plain text of the same template', async () => {
    setEnv(TWILIO_ENV);

    await notificationService.sendAppointmentConfirmation(appointment);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    expect(mockTwilioCreate.mock.calls[0][0]).toEqual({
      body: 'MedCita: Hola María Andrade, tu cita con Dra. Camila Torres ha sido agendada para el 2030-01-15 a las 10:00. ¡Te esperamos!',
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+593990000042'
    });
  });

  it('only prints the message (mock) when no provider is configured, and still counts as delivered', async () => {
    const delivered = await notificationService.sendReminder(appointment, { dayLabel: 'hoy' });

    expect(delivered).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockTwilioCreate).not.toHaveBeenCalled();
    const printed = console.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).toContain('Recordatorio MedCita: Hola María Andrade, tienes una cita hoy 2030-01-15 a las 10:00 con Dra. Camila Torres.');
  });

  it('prefers Meta over Twilio when both are configured', async () => {
    setEnv({ ...META_ENV, ...TWILIO_ENV });

    await notificationService.sendReminder(appointment);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });
});

describe('what gets logged', () => {
  const logged = () => [...console.log.mock.calls, ...console.error.mock.calls].map((c) => c.join(' ')).join('\n');
  const metaError = (code, extra = {}) => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: `(#${code}) Meta says no`, code, fbtrace_id: 'trace123', ...extra } })
  });

  it.each([
    ['Meta, delivered', () => setEnv(META_ENV)],
    ['Twilio, delivered', () => setEnv(TWILIO_ENV)],
    ['Meta, refused', () => { setEnv(META_ENV); global.fetch.mockResolvedValue(metaError(132001)); }],
    ['the console mock', () => {}]
  ])('never prints the full phone number (%s)', async (_label, configure) => {
    configure();

    await notificationService.sendReminder(appointment);

    expect(logged()).not.toContain('990000042');
    expect(logged()).toContain('+593***042');
  });

  it('does not print the message text in production', async () => {
    setEnv({ NODE_ENV: 'production' });

    await notificationService.sendReminder(appointment);

    expect(logged()).not.toContain('María Andrade');
  });

  it.each([
    [132001, /No approved template with this name and language/],
    [131030, /Manage phone number list/],
    [190, /permanent System User token/],
    [132000, /number of parameters/]
  ])('explains Meta error %i and says where to fix it', async (code, hint) => {
    setEnv(META_ENV);
    global.fetch.mockResolvedValue(metaError(code));

    await notificationService.sendReminder(appointment);

    const line = console.error.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).toContain(`code ${code}: (#${code}) Meta says no`);
    expect(line).toMatch(hint);
    expect(line).toContain('fbtrace_id: trace123');
  });

  it('includes the details Meta sends, and copes with an error it has no hint for', async () => {
    setEnv(META_ENV);
    global.fetch.mockResolvedValue(metaError(999999, { error_data: { details: 'Something new' } }));

    await notificationService.sendReminder(appointment);

    const line = console.error.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).toContain('details: Something new');
    expect(line).not.toContain('HINT');
  });

  it('copes with an error body that is not JSON', async () => {
    setEnv(META_ENV);
    global.fetch.mockResolvedValue({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' });

    const delivered = await notificationService.sendReminder(appointment);

    expect(delivered).toBe(false);
    expect(console.error.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('502 <html>Bad gateway</html>');
  });
});
