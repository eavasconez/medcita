const twilio = require('twilio');
const emailService = require('./emailService');
const { buildTemplate } = require('./whatsappTemplates');

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
// Overridable only so tests and local checks can point at a fake Graph API.
const GRAPH_BASE_URL = process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com';

const hasMetaCreds = () =>
  !!(process.env.META_WHATSAPP_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID);
const hasTwilioCreds = () =>
  !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

// Logs end up in the hosting provider's dashboard: keep patients' phone numbers
// out of them ("+593***042").
const maskPhone = (phone) => {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length > 6 ? `+${digits.slice(0, 3)}***${digits.slice(-3)}` : '***';
};

// What to do about the Meta errors an operator is most likely to hit. Meta's own
// message is logged too; these say where to fix it in this project.
const META_ERROR_HINTS = {
  190: 'The access token expired or is invalid. Create a permanent System User token and update META_WHATSAPP_TOKEN (docs/DEPLOY.md).',
  131030: 'The recipient is not in the allowed list of the test number. Add it under WhatsApp > API Setup > Manage phone number list.',
  131026: 'The message could not be delivered: the number may not use WhatsApp or is on an old version.',
  131047: 'More than 24 hours since the patient last wrote and this was not a template message. Send an approved template.',
  131056: 'Too many messages to the same number in a short time. It will work again shortly.',
  130429: 'Rate limit reached. It will work again shortly.',
  132000: 'The number of parameters does not match the approved template. Register it with the exact text in docs/DEPLOY.md.',
  132001: 'No approved template with this name and language. Check META_WHATSAPP_TEMPLATE_CONFIRMATION / _REMINDER and META_WHATSAPP_TEMPLATE_LANGUAGE, and that the template is APPROVED in WhatsApp Manager.',
  132012: 'A template parameter has the wrong format. Check the template text against docs/DEPLOY.md.',
  132015: 'The template is paused for low quality. Edit it in WhatsApp Manager.',
  132016: 'The template was disabled after being paused too often. Create a new one.'
};

// One line for the error log: status, Meta's code and message, our hint, and the
// trace id Meta support asks for. `raw` is the response body (JSON most times).
function describeMetaError(status, raw) {
  let error;
  try {
    error = JSON.parse(raw).error;
  } catch {
    // not JSON: log it as it came
  }
  if (!error) return `${status} ${String(raw).slice(0, 300)}`;

  const parts = [`${status} code ${error.code}: ${error.message}`];
  if (error.error_data?.details) parts.push(`details: ${error.error_data.details}`);
  if (META_ERROR_HINTS[error.code]) parts.push(`HINT: ${META_ERROR_HINTS[error.code]}`);
  if (error.fbtrace_id) parts.push(`fbtrace_id: ${error.fbtrace_id}`);
  return parts.join(' | ');
}

// Body of the Cloud API request. A business can only open a conversation with an
// approved template (type "template"); free-form text (type "text") is accepted
// only within 24 hours of the patient's last message, so it is kept just for
// callers that have no template.
function metaPayload(recipient, message, template) {
  if (!template) {
    return { messaging_product: 'whatsapp', to: recipient, type: 'text', text: { preview_url: false, body: message } };
  }
  return {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      components: [{ type: 'body', parameters: template.params.map((text) => ({ type: 'text', text })) }]
    }
  };
}

/**
 * Send a WhatsApp message through Meta's WhatsApp Cloud API.
 * Cloud API expects the recipient as digits only (no '+' / 'whatsapp:' prefix).
 * With a `template` (see whatsappTemplates.js) it sends that approved template.
 */
async function sendWhatsAppViaMeta(to, message, template) {
  const recipient = to.replace(/[^\d]/g, '');
  const url = `${GRAPH_BASE_URL}/${META_GRAPH_VERSION}/${process.env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metaPayload(recipient, message, template))
    });

    if (!res.ok) {
      console.error(`[META WHATSAPP ERROR] sending to ${maskPhone(recipient)}: ${describeMetaError(res.status, await res.text())}`);
      return false;
    }
    console.log(`[META WHATSAPP] ${template ? `Template ${template.name}` : 'Message'} sent successfully to ${maskPhone(recipient)}`);
    return true;
  } catch (error) {
    console.error('[META WHATSAPP ERROR]:', error.message);
    return false;
  }
}

/**
 * Send a WhatsApp message through the Twilio API.
 */
async function sendWhatsAppViaTwilio(to, message) {
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const formattedTo = to.startsWith('+') ? to : `+${to}`;
    await client.messages.create({
      body: message,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${formattedTo}`
    });
    console.log(`[TWILIO] WhatsApp sent successfully to ${maskPhone(formattedTo)}`);
    return true;
  } catch (error) {
    console.error('[TWILIO ERROR]:', error.message);
    return false;
  }
}

/**
 * Service to handle all outbound notifications (WhatsApp + Email)
 */
const notificationService = {
  /**
   * Send a WhatsApp message. Provider precedence: Meta Cloud API (official) ->
   * Twilio -> mock (console only) when no provider is configured.
   * `message` is the finished text; `template` (from whatsappTemplates.buildTemplate)
   * is what Meta needs to start a conversation, and is ignored by the other providers.
   */
  sendWhatsApp: async (to, message, template) => {
    if (hasMetaCreds()) {
      return sendWhatsAppViaMeta(to, message, template);
    }
    if (hasTwilioCreds()) {
      return sendWhatsAppViaTwilio(to, message);
    }
    // Mock: show the text while developing, but never a patient's name in production logs.
    const shown = process.env.NODE_ENV === 'production' ? '' : `, Message: ${message}`;
    console.log(`[WHATSAPP MOCK] To: ${maskPhone(to)}${shown}`);
    console.log('No WhatsApp provider configured, mocked output only.');
    return true;
  },

  /**
   * Send an email. Delegates provider selection and HTML templates to
   * emailService (Brevo preferred, SendGrid fallback, mock last).
   */
  sendEmail: emailService.sendEmail,

  /**
   * Send a full appointment confirmation (WhatsApp + Email)
   */
  sendAppointmentConfirmation: async (appointment) => {
    const { patient, doctor, date, time } = appointment;
    const whatsapp = buildTemplate('appointmentConfirmation', {
      patientName: patient.name,
      doctorName: doctor.name,
      date,
      time
    });
    const msg = whatsapp.text;

    // Each notification is independent: run them concurrently and don't let
    // one recipient's failure suppress the others (allSettled, not all).
    const tasks = [notificationService.sendWhatsApp(patient.phone, msg, whatsapp)];

    // Patient confirmation email
    if (patient.email) {
      const subject = 'Confirmación de Cita - MedCita';
      const html = emailService.templates.appointmentConfirmationHtml({
        patientName: patient.name,
        doctorName: doctor.name,
        date,
        time,
        address: doctor.address
      });
      tasks.push(notificationService.sendEmail(patient.email, subject, msg, html));
    }

    // Doctor notification email that a new appointment was booked
    if (doctor.email) {
      const doctorSubject = 'Nueva Cita Agendada - MedCita';
      const doctorMsg = `MedCita: ${patient.name} agendó una cita contigo el ${date} a las ${time}.`;
      const doctorHtml = emailService.templates.doctorNewAppointmentHtml({
        doctorName: doctor.name,
        patientName: patient.name,
        patientPhone: patient.phone,
        date,
        time
      });
      tasks.push(notificationService.sendEmail(doctor.email, doctorSubject, doctorMsg, doctorHtml));
    }

    await Promise.allSettled(tasks);
  },

  /**
   * Send a reminder (WhatsApp + Email). `dayLabel` is 'hoy' or 'mañana'
   * depending on when the appointment is. Resolves to true if at least one
   * channel delivered, so callers can retry when nothing went out.
   */
  sendReminder: async (appointment, { dayLabel = 'mañana' } = {}) => {
    const { patient, doctor, date, time } = appointment;
    const whatsapp = buildTemplate('appointmentReminder', {
      patientName: patient.name,
      whenText: `${dayLabel} ${date}`,
      time,
      doctorName: doctor.name
    });
    const msg = whatsapp.text;

    // Each channel is independent: one failing must not suppress the other.
    const tasks = [notificationService.sendWhatsApp(patient.phone, msg, whatsapp)];

    if (patient.email && patient.email.includes('@')) {
      const html = emailService.templates.reminderHtml({
        patientName: patient.name,
        doctorName: doctor.name,
        date,
        time,
        dayLabel
      });
      tasks.push(notificationService.sendEmail(patient.email, 'Recordatorio de Cita - MedCita', msg, html));
    }

    const results = await Promise.allSettled(tasks);
    return results.some((result) => result.status === 'fulfilled' && result.value === true);
  },

  /**
   * Email the account owner a password reset link. Resolves to true when the
   * email was delivered.
   */
  sendSignupConfirmation: async ({ name, email, clinicName, url, expiresInHours }) => {
    const text = [
      `Hola ${name},`,
      '',
      `Para terminar de crear el consultorio "${clinicName}" en MedCita, confirma que este correo es tuyo.`,
      `Abre este enlace (vale ${expiresInHours} horas y solo se puede usar una vez):`,
      url,
      '',
      'Si no pediste esta cuenta, ignora este correo: no se creará nada.'
    ].join('\n');
    const html = emailService.templates.signupConfirmationHtml({ name, clinicName, url, expiresInHours });
    return notificationService.sendEmail(email, `Confirma tu correo para crear ${clinicName} - MedCita`, text, html);
  },

  // Sent instead of a confirmation when the email already has an account, so the
  // page that asked for the sign-up never has to say which emails are registered.
  sendAccountAlreadyExists: async ({ doctor, loginUrl, resetUrl }) => {
    const text = [
      `Hola ${doctor.name},`,
      '',
      'Alguien intentó crear una cuenta de MedCita con este correo, pero ya tienes una, así que no se creó nada nuevo.',
      `Si fuiste tú, inicia sesión: ${loginUrl}`,
      `Si olvidaste tu contraseña, restablécela: ${resetUrl}`,
      '',
      'Si no fuiste tú, ignora este correo: tu cuenta sigue como estaba.'
    ].join('\n');
    const html = emailService.templates.accountExistsHtml({ name: doctor.name, loginUrl, resetUrl });
    return notificationService.sendEmail(doctor.email, 'Ya tienes una cuenta en MedCita', text, html);
  },

  sendInvitation: async ({ name, email, clinicName, invitedBy, role, url, expiresInDays }) => {
    const text = [
      `Hola ${name},`,
      '',
      `${invitedBy} te invitó a unirte al consultorio "${clinicName}" en MedCita.`,
      `Abre este enlace para aceptar y elegir tu contraseña (vale ${expiresInDays} días y solo se puede usar una vez):`,
      url,
      '',
      'Si no esperabas esta invitación, ignora este correo: no se creará ninguna cuenta.'
    ].join('\n');
    const html = emailService.templates.invitationHtml({ name, clinicName, invitedBy, role, url, expiresInDays });
    return notificationService.sendEmail(email, `${invitedBy} te invitó a ${clinicName} - MedCita`, text, html);
  },

  sendPasswordReset: async ({ doctor, resetUrl, expiresInMinutes }) => {
    const text = [
      `Hola ${doctor.name},`,
      '',
      'Recibimos una solicitud para restablecer la contraseña de tu cuenta de MedCita.',
      `Abre este enlace para elegir una nueva (vale ${expiresInMinutes} minutos y solo se puede usar una vez):`,
      resetUrl,
      '',
      'Si no pediste este cambio, ignora este correo: tu contraseña no se modificará.'
    ].join('\n');
    const html = emailService.templates.passwordResetHtml({ name: doctor.name, resetUrl, expiresInMinutes });
    return notificationService.sendEmail(doctor.email, 'Restablece tu contraseña - MedCita', text, html);
  }
};

module.exports = notificationService;
