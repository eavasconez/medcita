// Logs and the notification history end up where many people can read them: keep
// phones and emails recognisable but never complete.

// "+593990000042" -> "+593***042"
const maskPhone = (phone) => {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length > 6 ? `+${digits.slice(0, 3)}***${digits.slice(-3)}` : '***';
};

// "maria@gmail.com" -> "ma***@gmail.com"
const maskEmail = (to) => {
  const [local, domain] = String(to).split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 1))}@${domain}`;
};

// A provider's error text can repeat what we sent it: hide any email or long number.
const scrubText = (text) =>
  String(text ?? '')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '***@***')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '***')
    .replace(/\s+/g, ' ')
    .trim();

module.exports = { maskPhone, maskEmail, scrubText };
