// The WhatsApp messages the business starts on its own: the appointment
// confirmation and the reminders.
//
// Meta only lets a business open a conversation with a *template* it has
// registered and had approved (free-form text works only inside the 24 hours
// after the patient last wrote). So each message is defined once here:
//
// - `body` is the exact text to register in Meta (positional {{n}} variables);
// - `fields` says which value goes in each {{n}}, in order;
// - the same text, filled in, is what Twilio and the console mock send.
//
// docs/DEPLOY.md lists these bodies for whoever registers them (a test checks
// that the doc and this file agree).
//
// A template with `buttons: true` carries the three quick-reply buttons of whatsappButtons.js
// («Confirmo», «Cancelar», «Cambiar hora»), which are part of the template registered in Meta.
// Each send also gives every button the payload of that appointment.
const { BUTTONS, buttonPayload } = require('./whatsappButtons');

const TEMPLATES = {
  appointmentConfirmation: {
    nameEnvVar: 'META_WHATSAPP_TEMPLATE_CONFIRMATION',
    defaultName: 'cita_confirmada',
    body: 'MedCita: Hola {{1}}, tu cita con {{2}} ha sido agendada para el {{3}} a las {{4}}. ¡Te esperamos!',
    fields: ['patientName', 'doctorName', 'date', 'time']
  },
  appointmentReminder: {
    nameEnvVar: 'META_WHATSAPP_TEMPLATE_REMINDER',
    defaultName: 'recordatorio_cita',
    // Meta rejects a template with too many variables for its length (5 in a short text
    // was refused), so the day and the date travel as ONE variable ("mañana 2026-10-21")
    // and the text has a closing sentence.
    body: 'Recordatorio MedCita: Hola {{1}}, tienes una cita {{2}} a las {{3}} con {{4}}. Si no puedes asistir, avísanos con anticipación para liberar el horario. ¡Gracias!',
    fields: ['patientName', 'whenText', 'time', 'doctorName']
  },
  // The reminder for a clinic that set an address or indications (S9-03): the same text plus the
  // clinic's name and those details. A template of its own, so it has to be registered and
  // approved in Meta before it is used: until META_WHATSAPP_TEMPLATE_REMINDER_DETAILED is set,
  // Meta sends the plain reminder above (see reminderTemplateKey in notificationService.js).
  appointmentReminderDetailed: {
    nameEnvVar: 'META_WHATSAPP_TEMPLATE_REMINDER_DETAILED',
    defaultName: 'recordatorio_cita_consultorio',
    body: 'Recordatorio de {{1}}: Hola {{2}}, tienes una cita {{3}} a las {{4}} con {{5}}. Dónde y cómo llegar: {{6}}. Si no puedes asistir, avísanos con anticipación para liberar el horario. ¡Gracias!',
    fields: ['clinicName', 'patientName', 'whenText', 'time', 'doctorName', 'details']
  },
  // The two reminders above with the three reply buttons (S9-02). Templates of their own, so they
  // have to be registered and approved in Meta; they are used only once their name is set
  // (META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS / _DETAILED_BUTTONS) and the webhook that receives the
  // taps is configured (see reminderTemplateKey in notificationService.js).
  appointmentReminderButtons: {
    nameEnvVar: 'META_WHATSAPP_TEMPLATE_REMINDER_BUTTONS',
    defaultName: 'recordatorio_cita_botones',
    body: 'Recordatorio MedCita: Hola {{1}}, tienes una cita {{2}} a las {{3}} con {{4}}. Toca uno de los botones para confirmar, cancelar o pedir otro horario. ¡Gracias!',
    fields: ['patientName', 'whenText', 'time', 'doctorName'],
    buttons: true
  },
  appointmentReminderDetailedButtons: {
    nameEnvVar: 'META_WHATSAPP_TEMPLATE_REMINDER_DETAILED_BUTTONS',
    defaultName: 'recordatorio_cita_consultorio_botones',
    body: 'Recordatorio de {{1}}: Hola {{2}}, tienes una cita {{3}} a las {{4}} con {{5}}. Dónde y cómo llegar: {{6}}. Toca uno de los botones para confirmar, cancelar o pedir otro horario. ¡Gracias!',
    fields: ['clinicName', 'patientName', 'whenText', 'time', 'doctorName', 'details'],
    buttons: true
  }
};

const DEFAULT_LANGUAGE = 'es';
const MAX_PARAM_LENGTH = 1024;

// Meta rejects template parameters with line breaks, tabs, runs of more than 4
// spaces, or nothing at all. A patient name typed with a stray newline must not
// make the whole message fail.
function cleanParam(value) {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, MAX_PARAM_LENGTH);
  return text || '-';
}

const fill = (body, params) => body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1]);

/**
 * Builds a template message from named values, e.g.
 * buildTemplate('appointmentConfirmation', { patientName, doctorName, date, time }).
 * Returns { key, name, language, params, text, buttons }: `name`/`language` identify the
 * template registered in Meta, `params` fill its {{n}} in order, and `text` is
 * the finished message for the providers that send plain text. `buttons` is empty for a
 * template without them; otherwise it lists { action, label, payload }, where the payload
 * belongs to `values.appointment` ({ id, date, time }) and is null without one (a preview).
 */
function buildTemplate(key, values, env = process.env) {
  const template = TEMPLATES[key];
  if (!template) throw new Error(`Unknown WhatsApp template "${key}"`);

  const params = template.fields.map((field) => cleanParam(values[field]));
  return {
    key,
    name: env[template.nameEnvVar] || template.defaultName,
    language: env.META_WHATSAPP_TEMPLATE_LANGUAGE || DEFAULT_LANGUAGE,
    params,
    text: fill(template.body, params),
    buttons: template.buttons
      ? BUTTONS.map(({ action, label }) => ({ action, label, payload: values.appointment ? buttonPayload(action, values.appointment) : null }))
      : []
  };
}

module.exports = { TEMPLATES, buildTemplate };
