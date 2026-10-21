const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const hasBrevoCreds = () =>
  !!(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL);
const hasSendGridCreds = () => !!process.env.SENDGRID_API_KEY;

const EMAIL_TIMEOUT_MS = 10000;

/**
 * Mask an email address for logging (e.g. "jo***@example.com") so
 * patient contact info doesn't end up in plaintext logs.
 */
function maskEmail(to) {
  const [local, domain] = String(to).split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 1))}@${domain}`;
}

/**
 * Send an email through Brevo's transactional email API.
 */
async function sendEmailViaBrevo(to, subject, text, html) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
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
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      console.error(`[BREVO EMAIL ERROR] ${res.status} sending to ${maskEmail(to)}`);
      return false;
    }
    console.log(`[BREVO EMAIL] Email sent successfully to ${maskEmail(to)}`);
    return true;
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'request timed out' : error.message;
    console.error(`[BREVO EMAIL ERROR] sending to ${maskEmail(to)}:`, reason);
    return false;
  } finally {
    clearTimeout(timeout);
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
    await Promise.race([
      sgMail.send(msg),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('request timed out')), EMAIL_TIMEOUT_MS)
      )
    ]);
    console.log(`[SENDGRID] Email sent successfully to ${maskEmail(to)}`);
    return true;
  } catch (error) {
    console.error(`[SENDGRID ERROR] Failed to send to ${maskEmail(to)}:`, error.message);
    if (error.response) {
      console.error(`[SENDGRID ERROR] provider status: ${error.response.statusCode}`);
    }
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
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

function appointmentConfirmationHtml({ patientName, doctorName, date, time, address }) {
  const addressItem = address
    ? `<li><strong>Dirección:</strong> ${escapeHtml(address)}</li>`
    : '';
  return baseLayout('Cita confirmada', `
    <p>Hola <strong>${escapeHtml(patientName)}</strong>,</p>
    <p>Tu cita con <strong>${escapeHtml(doctorName)}</strong> ha sido agendada:</p>
    <ul>
      <li><strong>Fecha:</strong> ${escapeHtml(date)}</li>
      <li><strong>Hora:</strong> ${escapeHtml(time)}</li>
      ${addressItem}
    </ul>
    <p>¡Te esperamos!</p>
  `);
}

function reminderHtml({ patientName, doctorName, date, time, dayLabel = 'mañana' }) {
  return baseLayout('Recordatorio de cita', `
    <p>Hola <strong>${escapeHtml(patientName)}</strong>,</p>
    <p>Tienes una cita ${escapeHtml(dayLabel)} <strong>${escapeHtml(date)}</strong> a las <strong>${escapeHtml(time)}</strong> con <strong>${escapeHtml(doctorName)}</strong>.</p>
  `);
}

function passwordResetHtml({ name, resetUrl, expiresInMinutes }) {
  const url = escapeHtml(resetUrl);
  return baseLayout('Restablece tu contraseña', `
    <p>Hola <strong>${escapeHtml(name)}</strong>,</p>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta de MedCita. Usa el botón para elegir una nueva:</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${url}" style="background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Restablecer contraseña</a>
    </p>
    <p style="font-size: 13px; color: #64748b;">El enlace vale por ${escapeHtml(expiresInMinutes)} minutos y solo se puede usar una vez. Si el botón no funciona, copia y pega esta dirección en tu navegador:</p>
    <p style="font-size: 12px; color: #64748b; word-break: break-all;">${url}</p>
    <p style="font-size: 13px; color: #64748b;">Si no pediste este cambio, ignora este correo: tu contraseña no se modificará.</p>
  `);
}

function signupConfirmationHtml({ name, clinicName, url, expiresInHours }) {
  const link = escapeHtml(url);
  return baseLayout('Confirma tu correo', `
    <p>Hola <strong>${escapeHtml(name)}</strong>,</p>
    <p>Para terminar de crear el consultorio <strong>${escapeHtml(clinicName)}</strong> en MedCita, confirma que este correo es tuyo:</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${link}" style="background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Confirmar correo y entrar</a>
    </p>
    <p style="font-size: 13px; color: #64748b;">El enlace vale por ${escapeHtml(expiresInHours)} horas y solo se puede usar una vez. Si el botón no funciona, copia y pega esta dirección en tu navegador:</p>
    <p style="font-size: 12px; color: #64748b; word-break: break-all;">${link}</p>
    <p style="font-size: 13px; color: #64748b;">Si no pediste esta cuenta, ignora este correo: no se creará nada.</p>
  `);
}

function accountExistsHtml({ name, loginUrl, resetUrl }) {
  return baseLayout('Ya tienes una cuenta', `
    <p>Hola <strong>${escapeHtml(name)}</strong>,</p>
    <p>Alguien intentó crear una cuenta de MedCita con este correo, pero <strong>ya tienes una</strong>, así que no se creó nada nuevo.</p>
    <p>Si fuiste tú, <a href="${escapeHtml(loginUrl)}">inicia sesión</a>. Si olvidaste tu contraseña, puedes <a href="${escapeHtml(resetUrl)}">restablecerla aquí</a>.</p>
    <p style="font-size: 13px; color: #64748b;">Si no fuiste tú, ignora este correo: tu cuenta sigue como estaba.</p>
  `);
}

function doctorNewAppointmentHtml({ doctorName, patientName, patientPhone, date, time }) {
  const phoneItem = patientPhone
    ? `<li><strong>Teléfono:</strong> ${escapeHtml(patientPhone)}</li>`
    : '';
  return baseLayout('Nueva cita agendada', `
    <p>Hola <strong>${escapeHtml(doctorName)}</strong>,</p>
    <p>Un paciente ha agendado una nueva cita contigo:</p>
    <ul>
      <li><strong>Paciente:</strong> ${escapeHtml(patientName)}</li>
      ${phoneItem}
      <li><strong>Fecha:</strong> ${escapeHtml(date)}</li>
      <li><strong>Hora:</strong> ${escapeHtml(time)}</li>
    </ul>
  `);
}

const emailService = {
  /**
   * Send an email. Provider precedence: Brevo (preferred) -> SendGrid
   * (fallback, tried both when Brevo isn't configured and when a
   * configured Brevo actually fails to deliver) -> mock (console only)
   * when no provider is configured.
   */
  sendEmail: async (to, subject, text, html) => {
    if (!to || !to.includes('@')) {
      console.log(`[EMAIL SKIP] Invalid or missing email: ${maskEmail(to)}`);
      return false;
    }

    if (hasBrevoCreds()) {
      if (await sendEmailViaBrevo(to, subject, text, html)) return true;
      if (hasSendGridCreds()) return sendEmailViaSendGrid(to, subject, text, html);
      return false;
    }
    if (hasSendGridCreds()) {
      return sendEmailViaSendGrid(to, subject, text, html);
    }
    console.log(`[EMAIL MOCK] To: ${maskEmail(to)}, Subject: ${subject}`);
    console.log('No email provider configured, mocked output only.');
    return true;
  },

  templates: {
    appointmentConfirmationHtml,
    reminderHtml,
    passwordResetHtml,
    signupConfirmationHtml,
    accountExistsHtml,
    doctorNewAppointmentHtml
  }
};

module.exports = emailService;
