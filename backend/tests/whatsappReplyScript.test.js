const app = require('../src/server');
const notificationService = require('../src/services/notificationService');
const { main: simulateReply } = require('../scripts/simulateWhatsAppReply');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createPatient, createAppointment } = require('./helpers/factories');
const { clinicParts } = require('./helpers/time');
const { APP_SECRET, waitFor } = require('./helpers/whatsappWebhook');

let server;
let port;
let sendWhatsApp;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  process.env.META_APP_SECRET = APP_SECRET;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  sendWhatsApp = jest.spyOn(notificationService, 'sendWhatsApp');
});
afterEach(() => jest.restoreAllMocks());

const book = async (phone = '+593990000042') => {
  const { user: doctor } = await createUser();
  const patient = await createPatient({ phone });
  return createAppointment({ doctor, patient, ...clinicParts(30) });
};
const run = (args, env = {}) => {
  const lines = [];
  return simulateReply(args, { META_APP_SECRET: APP_SECRET, PORT: String(port), ...env }, (line) => lines.push(line)).then((code) => ({ code, lines }));
};
const status = async (appointment) => (await prisma.appointment.findUnique({ where: { id: appointment.id } })).status;

describe('npm run whatsapp:reply', () => {
  it('plays a tap on «confirm» through the real webhook, signed like Meta, and the agenda changes', async () => {
    const appointment = await book();

    const { code, lines } = await run([appointment.id, 'confirm']);
    await waitFor(() => sendWhatsApp.mock.calls.length >= 1);

    expect(code).toBe(0);
    expect(lines[0]).toBe(`Tap «confirm» on the appointment of ${appointment.date} ${appointment.time} (now "pending_approval"), from the number ending 042...`);
    expect(lines[1]).toBe('The server answered 200 {"received":true}');
    expect(await status(appointment)).toBe('confirmed');
  });

  it('plays «cancel» the same way', async () => {
    const appointment = await book();

    expect((await run([appointment.id, 'cancel'])).code).toBe(0);

    expect(await status(appointment)).toBe('cancelled');
  });

  it('can tap from another number, which the server ignores', async () => {
    const appointment = await book();

    const { code } = await run([appointment.id, 'cancel', '--from', '+593991111111']);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(code).toBe(0); // the call itself was accepted
    expect(await status(appointment)).toBe('pending_approval');
  });

  it('says so when the server refuses the signature (another secret)', async () => {
    const appointment = await book();

    const { code, lines } = await run([appointment.id, 'confirm'], { META_APP_SECRET: 'not-the-servers-secret' });

    expect(code).toBe(1);
    expect(lines[1]).toBe('The server answered 403 {"error":"Invalid signature"}');
    expect(await status(appointment)).toBe('pending_approval');
  });

  it('explains how to use it when the arguments are wrong', async () => {
    for (const args of [[], ['abc'], ['abc', 'refund'], ['abc', 'confirm', '--oops', 'x'], ['abc', 'confirm', '--from']]) {
      const { code, lines } = await run(args);
      expect(code).toBe(1);
      expect(lines[0]).toContain('Usage: npm run whatsapp:reply -- <appointment id> confirm|cancel|reschedule');
    }
  });

  it('asks for META_APP_SECRET when it is not set', async () => {
    const appointment = await book();

    const { code, lines } = await run([appointment.id, 'confirm'], { META_APP_SECRET: '' });

    expect(code).toBe(1);
    expect(lines[0]).toContain('META_APP_SECRET is not set');
  });

  it('says there is no such appointment', async () => {
    const { code, lines } = await run(['00000000-0000-4000-8000-000000000000', 'confirm']);

    expect(code).toBe(1);
    expect(lines[0]).toBe('There is no appointment 00000000-0000-4000-8000-000000000000 in this database.');
  });

  it('refuses a server that is not local, and sends nothing, unless it is named', async () => {
    const appointment = await book();
    const fetchSpy = jest.spyOn(global, 'fetch');

    const refused = await run([appointment.id, 'cancel', '--url', 'https://medcita-backend.onrender.com']);
    const wrongName = await run([appointment.id, 'cancel', '--url', 'https://medcita-backend.onrender.com'], { WHATSAPP_REPLY_HOST: 'otro.host' });

    expect([refused.code, wrongName.code]).toEqual([1, 1]);
    expect(refused.lines[0]).toContain('medcita-backend.onrender.com is not a local server');
    expect(refused.lines[0]).toContain('WHATSAPP_REPLY_HOST=medcita-backend.onrender.com npm run whatsapp:reply');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await status(appointment)).toBe('pending_approval');
  });

  it('says when the server is not running', async () => {
    const appointment = await book();

    const { code, lines } = await run([appointment.id, 'confirm', '--url', 'http://localhost:1']);

    expect(code).toBe(1);
    expect(lines[1]).toContain('Could not reach http://localhost:1');
  });
});
