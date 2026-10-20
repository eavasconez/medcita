const { parseArgs, main } = require('../scripts/sendTestWhatsApp');

const META = { META_WHATSAPP_TOKEN: 'test-token', META_WHATSAPP_PHONE_NUMBER_ID: '1234567890' };

describe('parseArgs', () => {
  it('takes a phone number and defaults to the confirmation', () => {
    expect(parseArgs(['+593999999999'])).toEqual({ phone: '+593999999999', kind: 'confirmation' });
  });

  it('accepts the reminder, and digits without +', () => {
    expect(parseArgs(['593999999999', 'reminder'])).toEqual({ phone: '593999999999', kind: 'reminder' });
  });

  it.each([
    [[], /Missing the phone number/],
    [['hello'], /not a phone number/],
    [['+59399'], /not a phone number/],
    [['+593999999999', 'birthday'], /Unknown message "birthday"/],
    [['+593999999999', 'reminder', 'extra'], /Unexpected extra arguments/]
  ])('rejects %j', (argv, message) => {
    expect(parseArgs(argv).error).toMatch(message);
  });
});

describe('main', () => {
  let saved;
  let lines;
  const out = (line) => lines.push(line);
  beforeEach(() => {
    saved = { ...process.env };
    Object.assign(process.env, { META_WHATSAPP_TOKEN: '', META_WHATSAPP_PHONE_NUMBER_ID: '', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '' });
    lines = [];
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => '{}' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    jest.restoreAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('sends the sample template through Meta and reports success', async () => {
    Object.assign(process.env, META);

    const code = await main(['+593999999999', 'reminder'], process.env, out);

    expect(code).toBe(0);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ to: '593999999999', type: 'template', template: { name: 'recordatorio_cita' } });
    expect(lines.join('\n')).toMatch(/Provider: Meta Cloud API[\s\S]*Template: recordatorio_cita \(es\)[\s\S]*OK: Meta Cloud API accepted/);
  });

  it('exits 1 and says so when Meta refuses the message', async () => {
    Object.assign(process.env, META);
    global.fetch.mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":{"code":131030,"message":"not allowed"}}' });

    const code = await main(['+593999999999'], process.env, out);

    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/FAILED/);
  });

  it('exits 1 with an explanation when no real provider is configured', async () => {
    const code = await main(['+593999999999'], process.env, out);

    expect(code).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(lines.join('\n')).toMatch(/nothing real was sent/);
  });

  it('prints the problem and exits 1 for bad arguments, sending nothing', async () => {
    Object.assign(process.env, META);

    const code = await main(['nope'], process.env, out);

    expect(code).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(lines[0]).toMatch(/not a phone number/);
  });
});
