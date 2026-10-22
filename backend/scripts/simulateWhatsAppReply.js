// Plays what Meta does when a patient taps a button of the WhatsApp reminder, against a local server,
// so the replies (S9-02) can be tried without Meta:
//
//   npm run whatsapp:reply -- <appointment id> confirm|cancel|reschedule [--from <number>] [--url <server>]
//
// It reads the appointment from the database of backend/.env, builds the button payload the reminder
// would have carried, signs the call with META_APP_SECRET exactly as Meta does, and posts it to
// /api/webhooks/whatsapp. The server must be running with the same .env, and with META_APP_SECRET set.
//
// `--from` is the number the tap comes from (the patient's own by default; another one shows what happens
// to a reminder that was forwarded). `--url` defaults to http://localhost:<PORT>. A server that is not
// local is refused unless it is named: WHATSAPP_REPLY_HOST=<host> npm run whatsapp:reply -- ...
require('dotenv').config();
const crypto = require('crypto');

const ACTIONS = ['confirm', 'cancel', 'reschedule'];

function parseArgs(argv) {
  const [appointmentId, action, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--from', '--url'].includes(rest[i]) || !rest[i + 1]) return { error: `Unexpected argument "${rest[i]}"` };
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return { appointmentId, action, ...options };
}

const isLocal = (host) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);

async function main(argv = process.argv.slice(2), env = process.env, out = console.log) {
  const { appointmentId, action, from, url, error } = parseArgs(argv);
  if (error || !appointmentId || !ACTIONS.includes(action)) {
    out(`${error ? `${error}. ` : ''}Usage: npm run whatsapp:reply -- <appointment id> ${ACTIONS.join('|')} [--from <number>] [--url <server>]`);
    return 1;
  }
  if (!env.META_APP_SECRET) {
    out('META_APP_SECRET is not set in backend/.env: the server would refuse an unsigned call. Set it (any long text works locally) and restart the server.');
    return 1;
  }

  const base = (url || `http://localhost:${env.PORT || 5000}`).replace(/\/+$/, '');
  let host;
  try {
    host = new URL(base).hostname;
  } catch {
    out(`"${base}" is not a URL.`);
    return 1;
  }
  if (!isLocal(host) && env.WHATSAPP_REPLY_HOST !== host) {
    out(`${host} is not a local server. This would act as Meta on it, and confirm or cancel a real patient's appointment. If you really mean it, run: WHATSAPP_REPLY_HOST=${host} npm run whatsapp:reply -- ...`);
    return 1;
  }

  const prisma = require('../src/config/prisma');
  const { buttonPayload } = require('../src/services/whatsappButtons');
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, date: true, time: true, status: true, patient: { select: { phone: true } } }
    });
    if (!appointment) {
      out(`There is no appointment ${appointmentId} in this database.`);
      return 1;
    }

    const sender = (from || appointment.patient.phone).replace(/\D/g, '');
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'SIMULATED',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            // no phone_number_id: the server only filters by it when the call says which number it is for
            metadata: {},
            messages: [{
              from: sender,
              id: `wamid.SIMULATED${crypto.randomBytes(8).toString('hex')}`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'button',
              button: { payload: buttonPayload(action, appointment), text: action }
            }]
          }
        }]
      }]
    });
    const signature = `sha256=${crypto.createHmac('sha256', env.META_APP_SECRET).update(body).digest('hex')}`;

    out(`Tap «${action}» on the appointment of ${appointment.date} ${appointment.time} (now "${appointment.status}"), from the number ending ${sender.slice(-3)}...`);
    const res = await fetch(`${base}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body });
    out(`The server answered ${res.status} ${await res.text()}`);
    return res.ok ? 0 : 1;
  } catch (err) {
    out(`Could not reach ${base}: ${err.cause?.code || err.message}. Is the server running?`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main };
