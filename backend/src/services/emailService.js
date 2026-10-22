const sgMail = require('@sendgrid/mail');
// Patient contact info must not end up in plaintext logs ("jo***@example.com")
const { maskEmail } = require('../utils/mask');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const hasBrevoCreds = () =>
  !!(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL);
const hasSendGridCreds = () => !!process.env.SENDGRID_API_KEY;

const EMAIL_TIMEOUT_MS = 10000;

// What a provider attempt returns: { ok, provider, messageId?, errorCode?, error? }
const sent = (provider, messageId = null) => ({ ok: true, provider, messageId });
const failed = (provider, errorCode, error) => ({ ok: false, provider, errorCode, error });

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

    const raw = typeof res.text === 'function' ? await res.text() : '';
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      // not JSON: nothing more to read
    }
    if (!res.ok) {
      console.error(`[BREVO EMAIL ERROR] ${res.status} sending to ${maskEmail(to)}`);
      return failed('brevo', body.code ? `brevo_${body.code}` : `brevo_${res.status}`, `${res.status} ${body.message || raw.slice(0, 200) || 'error'}`);
    }
    console.log(`[BREVO EMAIL] Email sent successfully to ${maskEmail(to)}`);
    return sent('brevo', body.messageId);
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    const reason = timedOut ? 'request timed out' : error.message;
    console.error(`[BREVO EMAIL ERROR] sending to ${maskEmail(to)}:`, reason);
    return failed('brevo', timedOut ? 'timeout' : 'network', reason);
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
    const [response] = await Promise.race([
      sgMail.send(msg),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('request timed out')), EMAIL_TIMEOUT_MS)
      )
    ]);
    console.log(`[SENDGRID] Email sent successfully to ${maskEmail(to)}`);
    return sent('sendgrid', response?.headers?.['x-message-id']);
  } catch (error) {
    console.error(`[SENDGRID ERROR] Failed to send to ${maskEmail(to)}:`, error.message);
    if (error.response) {
      console.error(`[SENDGRID ERROR] provider status: ${error.response.statusCode}`);
    }
    const status = error.response?.statusCode;
    const timedOut = error.message === 'request timed out';
    return failed('sendgrid', status ? `sendgrid_${status}` : timedOut ? 'timeout' : 'network', error.message);
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

function reminderHtml({ patientName, doctorName, date, time, dayLabel = 'mañana', clinicName, address, indications }) {
  const extras = [
    address ? `<li><strong>Dirección:</strong> ${escapeHtml(address)}</li>` : '',
    indications ? `<li><strong>Indicaciones:</strong> ${escapeHtml(indications)}</li>` : ''
  ].join('');
  return baseLayout('Recordatorio de cita', `
    <p>Hola <strong>${escapeHtml(patientName)}</strong>,</p>
    <p>Tienes una cita ${escapeHtml(dayLabel)} <strong>${escapeHtml(date)}</strong> a las <strong>${escapeHtml(time)}</strong> con <strong>${escapeHtml(doctorName)}</strong>${clinicName ? ` en <strong>${escapeHtml(clinicName)}</strong>` : ''}.</p>
    ${extras ? `<ul>${extras}</ul>` : ''}
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

const ROLE_LABELS_ES = { admin: 'administrador/a', secretary: 'secretario/a', doctor: 'médico/a' };

function invitationHtml({ name, clinicName, invitedBy, role, url, expiresInDays }) {
  const link = escapeHtml(url);
  return baseLayout(`Te invitaron a ${clinicName}`, `
    <p>Hola <strong>${escapeHtml(name)}</strong>,</p>
    <p><strong>${escapeHtml(invitedBy)}</strong> te invitó a unirte al consultorio:</p>
    <p style="text-align: center; font-size: 22px; font-weight: bold; color: #0f172a; margin: 20px 0 4px;">${escapeHtml(clinicName)}</p>
    <p style="text-align: center; color: #64748b; margin: 0 0 8px;">como ${escapeHtml(ROLE_LABELS_ES[role] || role)}</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${link}" style="background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Aceptar la invitación y elegir mi contraseña</a>
    </p>
    <p style="font-size: 13px; color: #64748b;">El enlace vale por ${escapeHtml(expiresInDays)} días y solo se puede usar una vez. Si el botón no funciona, copia y pega esta dirección en tu navegador:</p>
    <p style="font-size: 12px; color: #64748b; word-break: break-all;">${link}</p>
    <p style="font-size: 13px; color: #64748b;">Si no esperabas esta invitación, ignora este correo: no se creará ninguna cuenta.</p>
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
  /**
   * Send an email and say exactly what happened: { ok, provider, messageId?,
   * errorCode?, error?, simulated? }. Provider precedence: Brevo (preferred) ->
   * SendGrid (fallback, tried both when Brevo isn't configured and when a
   * configured Brevo actually fails to deliver) -> mock (console only) when no
   * provider is configured. When SendGrid saves a message Brevo could not send, the
   * result is ok and `error` keeps what went wrong with Brevo.
   */
  deliverEmail: async (to, subject, text, html) => {
    if (!to || !to.includes('@')) {
      console.log(`[EMAIL SKIP] Invalid or missing email: ${maskEmail(to)}`);
      return { ok: false, provider: 'none', errorCode: 'invalid_recipient', error: 'The recipient has no valid email address' };
    }

    if (hasBrevoCreds()) {
      const brevo = await sendEmailViaBrevo(to, subject, text, html);
      if (brevo.ok || !hasSendGridCreds()) return brevo;
      const sendgrid = await sendEmailViaSendGrid(to, subject, text, html);
      return sendgrid.ok
        ? { ...sendgrid, errorCode: brevo.errorCode, error: `Brevo failed (${brevo.error}); sent through SendGrid` }
        : sendgrid;
    }
    if (hasSendGridCreds()) {
      return sendEmailViaSendGrid(to, subject, text, html);
    }
    console.log(`[EMAIL MOCK] To: ${maskEmail(to)}, Subject: ${subject}`);
    console.log('No email provider configured, mocked output only.');
    return { ok: true, provider: 'mock', simulated: true };
  },

  /** Same, answering only whether the email went out. */
  sendEmail: async (to, subject, text, html) => (await emailService.deliverEmail(to, subject, text, html)).ok,

  templates: {
    appointmentConfirmationHtml,
    reminderHtml,
    passwordResetHtml,
    signupConfirmationHtml,
    accountExistsHtml,
    invitationHtml,
    doctorNewAppointmentHtml
  }
};

module.exports = emailService;
