// Loaded in every test worker before any test file (jest `setupFiles`), so the
// app and Prisma only ever see test configuration.
const { getTestDatabaseUrl } = require('./testDatabase');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = getTestDatabaseUrl();

// Long enough and not one of the example values server.js refuses to boot with.
process.env.JWT_SECRET = 'test-only-jwt-secret-0123456789-abcdefghijklmnop';
process.env.FRONTEND_URL = 'http://localhost:5173';

// Switch every messaging provider off. server.js loads backend/.env with dotenv,
// which never overrides variables that already exist (even empty ones), so real
// credentials in a developer's .env can't leak into the tests. Tests also stub
// the senders (see helpers/notifications.js) as a second layer.
for (const key of [
  'META_WHATSAPP_TOKEN',
  'META_WHATSAPP_PHONE_NUMBER_ID',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
  'BREVO_API_KEY',
  'BREVO_FROM_EMAIL',
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL'
]) {
  process.env[key] = '';
}
