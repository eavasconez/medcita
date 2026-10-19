const { rateLimit, MemoryStore } = require('express-rate-limit');

const MINUTE = 60 * 1000;

// Counters live in memory: right for the single instance the app runs on today
// (they reset on restart). A second instance would need a shared store (Redis,
// Postgres) so each one doesn't keep its own count.
const LIMITS = {
  // Only FAILED logins (401) count. The per-email limit is the real brute-force
  // defence because it doesn't depend on detecting the client IP; the per-IP one
  // is more generous and catches one machine trying many different accounts.
  loginPerEmail: { windowMs: 15 * MINUTE, limit: 5 },
  loginPerIp: { windowMs: 15 * MINUTE, limit: 20 }
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

// For tests: forget every counter so one test can't affect the next.
async function resetRateLimits() {
  await Promise.all(stores.map((store) => store.resetAll()));
}

module.exports = { LIMITS, loginIpLimiter, loginEmailLimiter, resetRateLimits };
