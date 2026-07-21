const twilio = require('twilio');
const emailService = require('./emailService');

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

const hasMetaCreds = () =>
  !!(process.env.META_WHATSAPP_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID);
const hasTwilioCreds = () =>
  !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

/**
 * Send a WhatsApp message through Meta's WhatsApp Cloud API.
 * Cloud API expects the recipient as digits only (no '+' / 'whatsapp:' prefix).
 */
async function sendWhatsAppViaMeta(to, message) {
  const recipient = to.replace(/[^\d]/g, '');
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${process.env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { preview_url: false, body: message }
      })
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[META WHATSAPP ERROR] ${res.status} sending to ${recipient}:`, body);
      return false;
    }
    console.log(`[META WHATSAPP] Message sent successfully to ${recipient}`);
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
   */
  sendWhatsApp: async (to, message) => {
    console.log(`[WHATSAPP MOCK] To: ${to}, Message: ${message}`);

    if (hasMetaCreds()) {
      return sendWhatsAppViaMeta(to, message);
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
    const msg = `MedCita: Hola ${patient.name}, tu cita con el ${doctor.name} ha sido agendada para el ${date} a las ${time}. ¡Te esperamos!`;

    // Send WhatsApp
    await notificationService.sendWhatsApp(patient.phone, msg);

    // Send Email if available
    if (patient.email) {
      const subject = 'Confirmación de Cita - MedCita';
      const html = emailService.templates.appointmentConfirmationHtml({
        patientName: patient.name,
        doctorName: doctor.name,
        date,
        time,
        address: doctor.address
      });
      await notificationService.sendEmail(patient.email, subject, msg, html);
    }
  },

  /**
   * Send a reminder (WhatsApp + Email)
   */
  sendReminder: async (appointment) => {
    const { patient, doctor, date, time } = appointment;
    const msg = `Recordatorio MedCita: Hola ${patient.name}, tienes una cita mañana ${date} a las ${time} con el ${doctor.name}.`;

    await notificationService.sendWhatsApp(patient.phone, msg);

    if (patient.email && patient.email.includes('@')) {
      const html = emailService.templates.reminderHtml({
        patientName: patient.name,
        doctorName: doctor.name,
        date,
        time
      });
      await notificationService.sendEmail(patient.email, 'Recordatorio de Cita - MedCita', msg, html);
    }
  }
};

module.exports = notificationService;
