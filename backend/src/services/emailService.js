const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const hasBrevoCreds = () =>
  !!(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL);
const hasSendGridCreds = () => !!process.env.SENDGRID_API_KEY;

/**
 * Send an email through Brevo's transactional email API.
 */
async function sendEmailViaBrevo(to, subject, text, html) {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'MedCita', email: process.env.BREVO_FROM_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text
      })
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[BREVO EMAIL ERROR] ${res.status} sending to ${to}:`, body);
      return false;
    }
    console.log(`[BREVO EMAIL] Email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error('[BREVO EMAIL ERROR]:', error.message);
    return false;
  }
}

/**
 * Send an email through SendGrid.
 */
async function sendEmailViaSendGrid(to, subject, text, html) {
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
}

function baseLayout(title, bodyHtml) {
  return `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
  <div style="background: #2563eb; padding: 24px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-size: 20px;">MedCita</h1>
  </div>
  <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
    <h2 style="font-size: 18px; margin-top: 0;">${title}</h2>
    ${bodyHtml}
  </div>
  <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 16px;">MedCita — Gestión de citas médicas</p>
</div>`;
}

function appointmentConfirmationHtml({ patientName, doctorName, date, time }) {
  return baseLayout('Cita confirmada', `
    <p>Hola <strong>${patientName}</strong>,</p>
    <p>Tu cita con <strong>${doctorName}</strong> ha sido agendada:</p>
    <ul>
      <li><strong>Fecha:</strong> ${date}</li>
      <li><strong>Hora:</strong> ${time}</li>
    </ul>
    <p>¡Te esperamos!</p>
  `);
}

function reminderHtml({ patientName, doctorName, date, time }) {
  return baseLayout('Recordatorio de cita', `
    <p>Hola <strong>${patientName}</strong>,</p>
    <p>Tienes una cita mañana <strong>${date}</strong> a las <strong>${time}</strong> con <strong>${doctorName}</strong>.</p>
  `);
}

const emailService = {
  /**
   * Send an email. Provider precedence: Brevo (preferred) -> SendGrid
   * (fallback) -> mock (console only) when no provider is configured.
   */
  sendEmail: async (to, subject, text, html) => {
    if (!to || !to.includes('@')) {
      console.log(`[EMAIL SKIP] Invalid or missing email: ${to}`);
      return false;
    }

    if (hasBrevoCreds()) {
      return sendEmailViaBrevo(to, subject, text, html);
    }
    if (hasSendGridCreds()) {
      return sendEmailViaSendGrid(to, subject, text, html);
    }
    console.log(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
    console.log('No email provider configured, mocked output only.');
    return true;
  },

  templates: {
    appointmentConfirmationHtml,
    reminderHtml
  }
};

module.exports = emailService;
