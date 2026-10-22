const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/server');
const { buttonPayload } = require('../../src/services/whatsappButtons');

const APP_SECRET = 'test-app-secret-0123456789';
const VERIFY_TOKEN = 'test-verify-token';

// What Meta puts in X-Hub-Signature-256 for a body
const signatureOf = (raw, secret = APP_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

let counter = 0;

// The message Meta sends when a patient taps a quick-reply button of a template
function buttonMessage({ from, payload, id = `wamid.test${++counter}` }) {
  return { from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'button', button: { payload, text: 'Confirmo' } };
}

// The whole call Meta makes: an entry with one "messages" change
function webhookBody(messages, { phoneNumberId = '1234567890', statuses } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId },
          ...(messages && { contacts: [{ profile: { name: 'Someone' }, wa_id: messages[0]?.from }], messages }),
          ...(statuses && { statuses })
        }
      }]
    }]
  };
}

// Posts a call signed the way Meta signs it. `signature` and `secret` can be overridden to send a bad one.
function postWebhook(body, { secret = APP_SECRET, signature, raw } = {}) {
  const text = raw ?? JSON.stringify(body);
  const req = request(app).post('/api/webhooks/whatsapp').set('Content-Type', 'application/json');
  if (signature !== null) req.set('X-Hub-Signature-256', signature ?? signatureOf(text, secret));
  return req.send(text);
}

// A patient taps one button of the reminder about `appointment`
const tap = (action, appointment, from, options = {}) =>
  postWebhook(webhookBody([buttonMessage({ from, payload: buttonPayload(action, appointment), id: options.id })]));

// Waits until what is sent after the response (the answer to the patient) has happened
async function waitFor(condition, { timeout = 3000 } = {}) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

module.exports = { APP_SECRET, VERIFY_TOKEN, signatureOf, buttonMessage, webhookBody, postWebhook, tap, waitFor };
