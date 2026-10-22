// How a clinic reminds its patients (S9-03): whether it does, how long before the appointment
// (a first reminder and, optionally, a second one), through which channels, and the details that
// go in the message (the clinic's address and a line of indications). The text of the WhatsApp
// message itself stays the template approved by Meta (services/whatsappTemplates.js).

const { appointmentInstant, clinicDateString } = require('../utils/clinicTime');

// How long before the appointment a reminder can go out
const REMINDER_HOURS = [2, 24, 48];
const MAX_ADDRESS_LENGTH = 150;
const MAX_INDICATIONS_LENGTH = 200;

// What the reminder task and the sender need to know about a clinic
const SETTINGS_SELECT = {
  id: true,
  name: true,
  timezone: true,
  address: true,
  reminderEnabled: true,
  reminderHours: true,
  secondReminderHours: true,
  reminderWhatsapp: true,
  reminderEmail: true,
  reminderIndications: true
};

// Meta rejects parameters with line breaks, tabs or runs of spaces, and a typed note is shown in
// a one-line field of a template, so text is written on one line.
const oneLine = (value) => value.replace(/\s+/g, ' ').trim();

// A clinic's settings as the API shows them
const present = (clinic) => ({
  enabled: clinic.reminderEnabled,
  hours: clinic.reminderHours,
  secondHours: clinic.secondReminderHours,
  whatsapp: clinic.reminderWhatsapp,
  email: clinic.reminderEmail,
  address: clinic.address,
  indications: clinic.reminderIndications
});

// "Av. Amazonas N34-12. Llegar 10 minutos antes": what is added to the reminders, or '' for nothing
const detailsOf = (clinic) => [clinic.address, clinic.reminderIndications].filter(Boolean).map((text) => text.replace(/[.\s]+$/, '')).join('. ');

// Checks a change to the settings and returns { data } to save (columns of Clinic) or { error }.
// `current` is the clinic as it is now: the rules look at the result, not only at what was sent
// (moving the first reminder to 2 hours makes a second one at 24 impossible).
function validateChange(body, current) {
  const data = {};
  const input = body || {};
  const flags = { enabled: 'reminderEnabled', whatsapp: 'reminderWhatsapp', email: 'reminderEmail' };

  for (const [key, column] of Object.entries(flags)) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') return { error: `${key} must be true or false` };
    data[column] = input[key];
  }
  if (input.hours !== undefined) {
    if (!REMINDER_HOURS.includes(input.hours)) return { error: `hours must be one of: ${REMINDER_HOURS.join(', ')}` };
    data.reminderHours = input.hours;
  }
  if (input.secondHours !== undefined) {
    if (input.secondHours !== null && !REMINDER_HOURS.includes(input.secondHours)) return { error: `secondHours must be null or one of: ${REMINDER_HOURS.join(', ')}` };
    data.secondReminderHours = input.secondHours;
  }
  for (const [key, column, max] of [['address', 'address', MAX_ADDRESS_LENGTH], ['indications', 'reminderIndications', MAX_INDICATIONS_LENGTH]]) {
    if (input[key] === undefined) continue;
    if (input[key] !== null && typeof input[key] !== 'string') return { error: `${key} must be text` };
    const text = input[key] === null ? '' : oneLine(input[key]);
    if (text.length > max) return { error: `${key} must be at most ${max} characters` };
    data[column] = text || null;
  }
  if (Object.keys(data).length === 0) {
    return { error: 'Send at least one of: enabled, hours, secondHours, whatsapp, email, address, indications' };
  }

  const next = { ...current, ...data };
  if (next.secondReminderHours !== null && next.secondReminderHours >= next.reminderHours) {
    return { error: 'The second reminder must be closer to the appointment than the first one' };
  }
  if (next.reminderEnabled && !next.reminderWhatsapp && !next.reminderEmail) {
    return { error: 'Choose at least one channel (WhatsApp or email) or turn the reminders off' };
  }
  return { data };
}

// The messages a clinic sent this month (in its own calendar): how many went out through each
// channel, and how many of those were reminders. Only what really left counts ("sent"): a message
// that failed or was only simulated costs nothing.
async function monthlyUsage(db, clinic, now = new Date()) {
  const month = clinicDateString(now, clinic.timezone).slice(0, 7);
  const since = appointmentInstant(`${month}-01`, '00:00', clinic.timezone);
  const rows = await db.notificationLog.groupBy({
    by: ['channel', 'kind'],
    where: { clinicId: clinic.id, status: 'sent', createdAt: { gte: since } },
    _count: { _all: true }
  });
  const usage = { month, whatsapp: { total: 0, reminders: 0 }, email: { total: 0, reminders: 0 } };
  for (const row of rows) {
    const channel = usage[row.channel];
    if (!channel) continue;
    channel.total += row._count._all;
    if (row.kind.includes('reminder')) channel.reminders += row._count._all;
  }
  return usage;
}

module.exports = {
  REMINDER_HOURS,
  MAX_ADDRESS_LENGTH,
  MAX_INDICATIONS_LENGTH,
  SETTINGS_SELECT,
  present,
  detailsOf,
  validateChange,
  monthlyUsage
};
