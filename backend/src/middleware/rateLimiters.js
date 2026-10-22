const { rateLimit } = require('express-rate-limit');
const prisma = require('../config/prisma');
const { PostgresStore } = require('../services/rateLimitStore');
const { exposeLinks } = require('../utils/tokens');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// The counters live in the database (services/rateLimitStore.js), so a deploy does not start
// every count from zero and several instances of the backend share them. Each limiter below
// has its own name, which prefixes its keys.
const LIMITS = {
  // Only FAILED logins (401) count. The per-email limit is the real brute-force
  // defence because it doesn't depend on detecting the client IP; the per-IP one
  // is more generous and catches one machine trying many different accounts.
  loginPerEmail: { windowMs: 15 * MINUTE, limit: 5 },
  loginPerIp: { windowMs: 15 * MINUTE, limit: 20 },
  // Every request counts: each one can send an email, so this also stops the
  // endpoint from being used to flood someone's inbox or burn the email quota.
  forgotPasswordPerEmail: { windowMs: HOUR, limit: 3 },
  forgotPasswordPerIp: { windowMs: HOUR, limit: 10 },
  // Only failed attempts (400) count.
  resetPasswordPerIp: { windowMs: 15 * MINUTE, limit: 10 },
  // Only a wrong current password counts (403). Whoever is guessing it already holds a
  // session, so the limit is per account, not per IP.
  changePasswordPerAccount: { windowMs: 15 * MINUTE, limit: 5 },
  // Only requests that send an email count (a confirmation, or a notice to the owner
  // of an existing account): they stop sign-ups from flooding an inbox or burning the
  // email quota. A request rejected for its data sends nothing.
  registerPerEmail: { windowMs: HOUR, limit: 3 },
  registerPerIp: { windowMs: HOUR, limit: 5 },
  // Only failed attempts (400) count: someone guessing links, or retrying a dead one.
  accountLinkPerIp: { windowMs: 15 * MINUTE, limit: 10 },
  // Every invitation or resend sends an email to someone outside the clinic.
  invitePerAdmin: { windowMs: HOUR, limit: 20 },
  // Only calls to the WhatsApp webhook that Meta would never make (wrong token or signature, 403) count:
  // Meta's own calls are never held back.
  webhookPerIp: { windowMs: 15 * MINUTE, limit: 30 }
};

const normalizedEmail = (req) => {
  const email = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
};

const waitText = (seconds) => {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

function createLimiter({ name, windowMs, limit, message, keyGenerator, skip, countOnlyStatus }) {
  const store = new PostgresStore({ prefix: name });

  return rateLimit({
    windowMs,
    limit,
    store,
    // If the database cannot be reached for a count, let the request through: whatever it
    // needs (a login, a sign-up) needs the database too and fails there on its own
    passOnStoreError: true,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator && { keyGenerator }),
    ...(skip && { skip }),
    // Count only responses with this status; everything else is handed back.
    ...(countOnlyStatus && {
      skipSuccessfulRequests: true,
      requestWasSuccessful: (req, res) => res.statusCode !== countOnlyStatus
    }),
    handler: (req, res) => {
      const resetTime = req.rateLimit?.resetTime ?? new Date(Date.now() + windowMs);
      const retryAfterSeconds = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
      res.status(429).json({ error: `${message} Please try again in ${waitText(retryAfterSeconds)}.`, retryAfterSeconds });
    }
  });
}

const loginMessage = 'Too many failed login attempts.';

// Per client IP (express-rate-limit's default key, with IPv6 subnets grouped).
const loginIpLimiter = createLimiter({ name: 'login-ip', ...LIMITS.loginPerIp, message: loginMessage, countOnlyStatus: 401 });

// Per account, whatever IP the attempts come from. Skipped when the request has
// no usable email (the IP limiter still applies).
const loginEmailLimiter = createLimiter({
  name: 'login-email',
  ...LIMITS.loginPerEmail,
  message: loginMessage,
  countOnlyStatus: 401,
  keyGenerator: normalizedEmail,
  skip: (req) => !normalizedEmail(req)
});

const forgotPasswordMessage = 'Too many password reset requests.';

const forgotPasswordIpLimiter = createLimiter({ name: 'forgot-ip', ...LIMITS.forgotPasswordPerIp, message: forgotPasswordMessage });

const forgotPasswordEmailLimiter = createLimiter({
  name: 'forgot-email',
  ...LIMITS.forgotPasswordPerEmail,
  message: forgotPasswordMessage,
  keyGenerator: normalizedEmail,
  skip: (req) => !normalizedEmail(req)
});

const resetPasswordIpLimiter = createLimiter({
  name: 'reset-ip',
  ...LIMITS.resetPasswordPerIp,
  message: 'Too many attempts to reset the password.',
  countOnlyStatus: 400
});

const registerMessage = 'Too many sign-up requests.';

// QA mode (EXPOSE_ACCOUNT_LINKS, never on a hosted service) lifts the limits of the
// sign-up and invitation links, so a test script can run over and over from one machine.
const registerIpLimiter = createLimiter({
  name: 'register-ip',
  ...LIMITS.registerPerIp,
  message: registerMessage,
  countOnlyStatus: 202,
  skip: exposeLinks
});

const registerEmailLimiter = createLimiter({
  name: 'register-email',
  ...LIMITS.registerPerEmail,
  message: registerMessage,
  countOnlyStatus: 202,
  keyGenerator: normalizedEmail,
  skip: (req) => exposeLinks() || !normalizedEmail(req)
});

// Shared by every endpoint that exchanges an emailed link for something (confirm a
// sign-up, look at or accept an invitation).
const accountLinkIpLimiter = createLimiter({
  name: 'account-link-ip',
  ...LIMITS.accountLinkPerIp,
  message: 'Too many attempts with an invalid link.',
  countOnlyStatus: 400,
  skip: exposeLinks
});

// Must run after the auth middleware: it is keyed by the authenticated account.
const inviteLimiter = createLimiter({
  name: 'invite-admin',
  ...LIMITS.invitePerAdmin,
  message: 'Too many invitations sent.',
  keyGenerator: (req) => req.doctorId,
  skip: exposeLinks
});

// Must run after the auth middleware: it is keyed by the authenticated account.
const changePasswordLimiter = createLimiter({
  name: 'change-password',
  ...LIMITS.changePasswordPerAccount,
  message: 'Too many incorrect attempts to change the password.',
  countOnlyStatus: 403,
  keyGenerator: (req) => req.doctorId
});

// The WhatsApp webhook (routes/webhooks.js) is open to the internet: whoever keeps guessing the verify
// token or sending unsigned calls is stopped. Per client IP, so Meta (other addresses) is not affected.
const webhookIpLimiter = createLimiter({
  name: 'webhook-ip',
  ...LIMITS.webhookPerIp,
  message: 'Too many invalid webhook calls.',
  countOnlyStatus: 403
});

// Someone who just proved they own the account's email by resetting the password
// should not stay locked out by the failed logins that made them reset it.
async function clearLoginAttempts(email) {
  await loginEmailLimiter.resetKey(String(email).trim().toLowerCase());
}

// Forget every counter: for tests (so one cannot lock out the next), and for QA after running a
// script of failed logins over and over (`npm run limits:reset`).
async function resetRateLimits() {
  await prisma.rateLimitCounter.deleteMany();
}

module.exports = {
  LIMITS,
  loginIpLimiter,
  loginEmailLimiter,
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  resetPasswordIpLimiter,
  changePasswordLimiter,
  registerIpLimiter,
  registerEmailLimiter,
  accountLinkIpLimiter,
  inviteLimiter,
  webhookIpLimiter,
  clearLoginAttempts,
  resetRateLimits
};
