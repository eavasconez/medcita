// The three buttons of the reminder (S9-02) and what travels inside each one.
//
// When a patient taps a button, Meta calls our webhook with the `payload` we put in that
// button when the reminder was sent. The payload is what ties the tap to ONE appointment,
// never the phone number: a phone is unique only inside a clinic, so the same number can be
// a patient in two of them.
//
//   <action>.<appointment id>.<date and time of the visit>.<signature>
//
// - The signature (HMAC of the first three parts) says MedCita wrote it: nobody can make up
//   a payload for an appointment they only know the id of.
// - The date and time say WHICH visit the reminder was about. If the visit was moved after
//   the reminder went out, the old buttons no longer match it and change nothing: a patient
//   answering "cancel" to a message about tomorrow must not cancel next week's visit.

const crypto = require('crypto');

// `label` is the text on the button (Meta allows 25 characters); `code` is what the payload carries
const BUTTONS = [
  { action: 'confirm', code: 'c', label: 'Confirmo' },
  { action: 'cancel', code: 'x', label: 'Cancelar' },
  { action: 'reschedule', code: 'r', label: 'Cambiar hora' }
];

const SIGNATURE_LENGTH = 22; // base64url characters: 132 bits, plenty for a signature that is only checked here
const PAYLOAD_REGEX = /^([cxr])\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{12})\.([A-Za-z0-9_-]{22})$/;

// 'YYYY-MM-DD' + 'HH:mm' as 12 digits: the visit the reminder talks about
const stampOf = (date, time) => `${date.replace(/-/g, '')}${time.replace(':', '')}`;

// The JWT secret signs the buttons too (a label keeps the two uses apart), so there is no
// extra secret to set. Changing it makes the buttons of reminders already sent stop working.
const sign = (text) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(`whatsapp-button:${text}`).digest('base64url').slice(0, SIGNATURE_LENGTH);

const actionOfCode = (code) => BUTTONS.find((button) => button.code === code)?.action;

/** The payload of one button of the reminder about `appointment` ({ id, date, time }). */
function buttonPayload(action, appointment) {
  const button = BUTTONS.find((candidate) => candidate.action === action);
  if (!button) throw new Error(`Unknown WhatsApp button "${action}"`);
  const body = `${button.code}.${appointment.id}.${stampOf(appointment.date, appointment.time)}`;
  return `${body}.${sign(body)}`;
}

/**
 * Reads what a button brought back: { action, appointmentId, stamp }, or null when it is not
 * one of ours (made up, cut, or signed with another secret).
 */
function parseButtonPayload(payload) {
  const match = typeof payload === 'string' ? PAYLOAD_REGEX.exec(payload) : null;
  if (!match) return null;
  const [, code, appointmentId, stamp, signature] = match;
  const expected = Buffer.from(sign(`${code}.${appointmentId}.${stamp}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return { action: actionOfCode(code), appointmentId, stamp };
}

module.exports = { BUTTONS, stampOf, buttonPayload, parseButtonPayload };
