const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/**
 * Service to handle all outbound notifications (WhatsApp + Email)
 */
const notificationService = {
  /**
   * Send a WhatsApp message via Twilio
   */
  sendWhatsApp: async (to, message) => {
    console.log(`[WHATSAPP MOCK] To: ${to}, Message: ${message}`);
    
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        
        // Ensure international format
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
    } else {
      console.log('Twilio credentials not found, mocked output only.');
      return true;
    }
  },

  /**
   * Send an Email via SendGrid
   */
  sendEmail: async (to, subject, text, html) => {
    if (!to || !to.includes('@')) {
      console.log(`[SENDGRID SKIP] Invalid or missing email: ${to}`);
      return false;
    }

    if (process.env.SENDGRID_API_KEY) {
      try {
        const msg = {
          to,
          from: process.env.SENDGRID_FROM_EMAIL || 'no-reply@medcita.ec',
          subject,
          text,
          html: html || `<p>${text}</p>`
        };
        await sgMail.send(msg);
        console.log(`[SENDGRID] Email sent successfully to ${to}`);
        return true;
      } catch (error) {
        console.error(`[SENDGRID ERROR] Failed to send to ${to}:`, error.message);
        if (error.response) {
          console.error(JSON.stringify(error.response.body, null, 2));
        }
        return false;
      }
    } else {
      console.log(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
      console.log('SendGrid API key not found, mocked output only.');
      return true;
    }
  },

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
      await notificationService.sendEmail(patient.email, subject, msg);
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
      await notificationService.sendEmail(patient.email, 'Recordatorio de Cita - MedCita', msg);
    }
  }
};

module.exports = notificationService;
