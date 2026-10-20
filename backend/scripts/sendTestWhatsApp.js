// Sends ONE sample WhatsApp message with the provider configured in backend/.env,
// to check the setup without booking an appointment:
//
//   npm run whatsapp:test -- +593999999999            (confirmation template)
//   npm run whatsapp:test -- +593999999999 reminder   (24h reminder template)
//
// With Meta it sends the real approved template, so the recipient must be on the
// test number's allowed list (docs/DEPLOY.md, "WhatsApp con Meta"). Exit code 0
// means the provider accepted the message; 1 means it did not, or that no real
// provider is configured (the mock only prints).
const KINDS = {
  confirmation: 'appointmentConfirmation',
  reminder: 'appointmentReminder'
};

function parseArgs(argv) {
  const [phone, kind = 'confirmation', ...extra] = argv;
  if (!phone) return { error: 'Missing the phone number. Example: npm run whatsapp:test -- +593999999999' };
  if (!/^\+?\d{8,15}$/.test(phone)) return { error: `"${phone}" is not a phone number. Use digits with the country code, e.g. +593999999999.` };
  if (!KINDS[kind]) return { error: `Unknown message "${kind}". Use: ${Object.keys(KINDS).join(' or ')}.` };
  if (extra.length) return { error: `Unexpected extra arguments: ${extra.join(' ')}` };
  return { phone, kind };
}

const tomorrow = () => {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const providerOf = (env) =>
  env.META_WHATSAPP_TOKEN && env.META_WHATSAPP_PHONE_NUMBER_ID ? 'Meta Cloud API'
    : env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? 'Twilio'
      : null;

async function main(argv, env = process.env, out = console.log) {
  const args = parseArgs(argv);
  if (args.error) {
    out(args.error);
    return 1;
  }

  // required here, after backend/.env has been loaded, because the service reads its settings from the environment
  const { buildTemplate } = require('../src/services/whatsappTemplates');
  const notificationService = require('../src/services/notificationService');

  const provider = providerOf(env);
  const template = buildTemplate(
    KINDS[args.kind],
    {
      patientName: 'Paciente de prueba',
      doctorName: 'Dr. Prueba',
      date: tomorrow(),
      // the reminder takes the day and the date as one value, like notificationService.sendReminder builds it
      whenText: `mañana ${tomorrow()}`,
      time: '10:00'
    },
    env
  );

  out(`Provider: ${provider || 'none (mock: it only prints, nothing is sent)'}`);
  if (provider === 'Meta Cloud API') out(`Template: ${template.name} (${template.language})`);
  out(`Message:  ${template.text}`);

  const delivered = await notificationService.sendWhatsApp(args.phone, template.text, template);

  if (!provider) {
    out('\nNo WhatsApp provider is configured in backend/.env, so nothing real was sent. Set META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID (docs/DEPLOY.md).');
    return 1;
  }
  out(delivered
    ? `\nOK: ${provider} accepted the message. Check the phone.`
    : '\nFAILED: the provider did not accept the message. The error and what to do about it are in the lines above.');
  return delivered ? 0 : 1;
}

module.exports = { parseArgs, main };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
