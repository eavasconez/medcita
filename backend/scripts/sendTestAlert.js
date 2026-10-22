// Sends ONE sample server-error alert to the addresses of ERROR_ALERT_EMAILS, to check the setup
// without waiting for a real error:  `npm run alerts:test`
//
// It goes through the same code as a real alert (including the email provider of backend/.env), so
// when it arrives, real ones will. Exit code 0 means the alert was handed to the provider; 1 means
// ERROR_ALERT_EMAILS is empty or the email could not be sent. With no email provider configured the
// mock only prints, and says so.
require('dotenv').config();

async function main(env = process.env, out = console.log) {
  const { recipientsOf, createErrorAlerts } = require('../src/services/errorAlerts');
  const emailService = require('../src/services/emailService');

  const recipients = recipientsOf(env);
  if (recipients.length === 0) {
    out('ERROR_ALERT_EMAILS has no valid address. Set it (comma-separated) in backend/.env or in Render and try again.');
    return 1;
  }

  let failed = false;
  const send = async (to, subject, text, html) => {
    const detail = await emailService.deliverEmail(to, subject, text, html);
    out(`${detail.ok ? 'OK' : 'FAILED'} -> ${to} (${detail.provider}${detail.simulated ? ', simulated: no email provider is configured' : ''})${detail.error ? `: ${detail.error}` : ''}`);
    if (!detail.ok) failed = true;
    return detail;
  };

  const alerts = createErrorAlerts({ env, send });
  await alerts.report({ method: 'GET', route: '/api/alerts-test', status: 500, error: { name: 'TestAlert' } });
  return failed ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main };
