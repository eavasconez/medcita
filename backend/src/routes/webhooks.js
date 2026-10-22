const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { processWebhook } = require('../services/patientReplies');
const { requestOrigin } = require('../services/auditLog');

// The calls Meta makes to MedCita (S9-02): the first endpoint open to the internet without a login.
// Nothing is trusted until it proves it comes from Meta:
//
//   GET  /api/webhooks/whatsapp   once, when the webhook is set up in the Meta dashboard: Meta sends the
//                                 verify token we agreed on and expects its `hub.challenge` back.
//   POST /api/webhooks/whatsapp   every message a patient sends and every delivery receipt, signed by Meta
//                                 with the app secret (X-Hub-Signature-256) over the exact bytes of the body.
//
// META_WEBHOOK_VERIFY_TOKEN and META_APP_SECRET come from the environment (docs/WHATSAPP_META_SETUP.md);
// while one is missing the endpoint answers 503 instead of accepting anything.

// A real call is a few kilobytes; this only keeps someone from sending megabytes to be hashed
const MAX_BODY = '256kb';
const SIGNATURE_PREFIX = 'sha256=';

// Compares two strings without telling, through timing, how many characters matched
function sameSecret(given, expected) {
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function validSignature(rawBody, header, appSecret) {
  if (typeof header !== 'string' || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return sameSecret(header.slice(SIGNATURE_PREFIX.length), expected);
}

router.get('/whatsapp', (req, res) => {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) return res.status(503).json({ error: 'The WhatsApp webhook is not configured' });

  // The dotted names are flat keys ("hub.mode") with Express's default query parser
  const mode = req.query['hub.mode'] ?? req.query.hub?.mode;
  const token = req.query['hub.verify_token'] ?? req.query.hub?.verify_token;
  const challenge = req.query['hub.challenge'] ?? req.query.hub?.challenge;

  if (mode !== 'subscribe' || !sameSecret(token, verifyToken)) return res.status(403).json({ error: 'Invalid verify token' });
  // Meta's challenge is a number; anything else is not Meta's and is not echoed back
  if (typeof challenge !== 'string' || !/^[\w-]{1,200}$/.test(challenge)) return res.status(400).json({ error: 'Invalid challenge' });
  res.status(200).type('text/plain').send(challenge);
});

// The signature covers the raw bytes, so the body is read as a Buffer here and parsed only after it checks out
router.post('/whatsapp', express.raw({ type: () => true, limit: MAX_BODY }), async (req, res) => {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return res.status(503).json({ error: 'The WhatsApp webhook is not configured' });

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!validSignature(rawBody, req.get('x-hub-signature-256'), appSecret)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'The body is not valid JSON' });
  }

  // What was decided is saved before answering: if the database fails, Meta is told to try again
  // (the messages that did get saved are recognised as repeats). Answers to patients and notices to
  // the staff go out after, so Meta is not kept waiting on another provider.
  const { results, failures } = await processWebhook(body, { origin: requestOrigin(req) });
  res.status(failures ? 500 : 200).json(failures ? { error: 'Could not process every message' } : { received: true });

  for (const { followUp } of results) {
    if (!followUp) continue;
    try {
      await followUp();
    } catch (err) {
      console.error('WhatsApp reply follow-up failed:', err);
    }
  }
});

module.exports = router;
