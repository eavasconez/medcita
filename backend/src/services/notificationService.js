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
      const body = await res.text();
      console.error(`[META WHATSAPP ERROR] ${res.status} sending to ${recipient}:`, body);
      return false;
    }
    console.log(`[META WHATSAPP] ${template ? `Template ${template.name}` : 'Message'} sent successfully to ${recipient}`);
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
    console.log(`[TWILIO] WhatsApp sent successfully to ${formattedTo}`);
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
    console.log(`[WHATSAPP MOCK] To: ${to}, Message: ${message}`);

    if (hasMetaCreds()) {
      return sendWhatsAppViaMeta(to, message, template);
    }
    if (hasTwilioCreds()) {
      return sendWhatsAppViaTwilio(to, message);
    }
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
      dayLabel,
      date,
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
