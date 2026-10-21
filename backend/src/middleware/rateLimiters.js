const { rateLimit, MemoryStore } = require('express-rate-limit');
const { exposeLinks } = require('../utils/tokens');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Counters live in memory: right for the single instance the app runs on today
// (they reset on restart). A second instance would need a shared store (Redis,
// Postgres) so each one doesn't keep its own count.
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
  invitePerAdmin: { windowMs: HOUR, limit: 20 }
};

const stores = [];

const normalizedEmail = (req) => {
  const email = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
};

const waitText = (seconds) => {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

function createLimiter({ windowMs, limit, message, keyGenerator, skip, countOnlyStatus }) {
  const store = new MemoryStore();
  stores.push(store);

  return rateLimit({
    windowMs,
    limit,
    store,
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
const loginIpLimiter = createLimiter({ ...LIMITS.loginPerIp, message: loginMessage, countOnlyStatus: 401 });

// Per account, whatever IP the attempts come from. Skipped when the request has
// no usable email (the IP limiter still applies).
const loginEmailLimiter = createLimiter({
  ...LIMITS.loginPerEmail,
  message: loginMessage,
  countOnlyStatus: 401,
  keyGenerator: normalizedEmail,
  skip: (req) => !normalizedEmail(req)
});

const forgotPasswordMessage = 'Too many password reset requests.';

const forgotPasswordIpLimiter = createLimiter({ ...LIMITS.forgotPasswordPerIp, message: forgotPasswordMessage });

const forgotPasswordEmailLimiter = createLimiter({
  ...LIMITS.forgotPasswordPerEmail,
  message: forgotPasswordMessage,
  keyGenerator: normalizedEmail,
  skip: (req) => !normalizedEmail(req)
});

const resetPasswordIpLimiter = createLimiter({
  ...LIMITS.resetPasswordPerIp,
  message: 'Too many attempts to reset the password.',
  countOnlyStatus: 400
});

const registerMessage = 'Too many sign-up requests.';

// QA mode (EXPOSE_ACCOUNT_LINKS, never on a hosted service) lifts the limits of the
// sign-up and invitation links, so a test script can run over and over from one machine.
const registerIpLimiter = createLimiter({
  ...LIMITS.registerPerIp,
  message: registerMessage,
  countOnlyStatus: 202,
  skip: exposeLinks
});

const registerEmailLimiter = createLimiter({
  ...LIMITS.registerPerEmail,
  message: registerMessage,
  countOnlyStatus: 202,
  keyGenerator: normalizedEmail,
  skip: (req) => exposeLinks() || !normalizedEmail(req)
});

// Shared by every endpoint that exchanges an emailed link for something (confirm a
// sign-up, look at or accept an invitation).
const accountLinkIpLimiter = createLimiter({
  ...LIMITS.accountLinkPerIp,
  message: 'Too many attempts with an invalid link.',
  countOnlyStatus: 400,
  skip: exposeLinks
});

// Must run after the auth middleware: it is keyed by the authenticated account.
const inviteLimiter = createLimiter({
  ...LIMITS.invitePerAdmin,
  message: 'Too many invitations sent.',
  keyGenerator: (req) => req.doctorId,
  skip: exposeLinks
});

// Must run after the auth middleware: it is keyed by the authenticated account.
const changePasswordLimiter = createLimiter({
  ...LIMITS.changePasswordPerAccount,
  message: 'Too many incorrect attempts to change the password.',
  countOnlyStatus: 403,
  keyGenerator: (req) => req.doctorId
});

// Someone who just proved they own the account's email by resetting the password
// should not stay locked out by the failed logins that made them reset it.
async function clearLoginAttempts(email) {
  await loginEmailLimiter.resetKey(String(email).trim().toLowerCase());
}

// For tests: forget every counter so one test can't affect the next.
async function resetRateLimits() {
  await Promise.all(stores.map((store) => store.resetAll()));
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
  clearLoginAttempts,
  resetRateLimits
};
