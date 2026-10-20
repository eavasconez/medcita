// The WhatsApp messages the business starts on its own: the appointment
// confirmation and the 24h reminder.
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
 * Returns { key, name, language, params, text }: `name`/`language` identify the
 * template registered in Meta, `params` fill its {{n}} in order, and `text` is
 * the finished message for the providers that send plain text.
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
    text: fill(template.body, params)
  };
}

module.exports = { TEMPLATES, buildTemplate };
