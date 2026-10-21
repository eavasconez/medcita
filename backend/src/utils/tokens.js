const crypto = require('crypto');

// The single-use links MedCita emails (reset a password, confirm a sign-up, accept
// an invitation) all work the same way: 32 random bytes travel in the link as
// base64url, and the database only keeps their SHA-256 hash, so a leaked table can
// not be turned back into usable links.

// 32 bytes encoded as base64url are always 43 characters long.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const newToken = () => crypto.randomBytes(32).toString('base64url');

// Tokens are high-entropy random values, so a plain SHA-256 is enough: there is
// nothing to brute force.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// FRONTEND_URL may list several CORS origins; the first one is the app itself.
function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/+$/, '');
}

// A link into the app, e.g. frontendLink('/verify-email', token)
const frontendLink = (path, token) => `${frontendUrl()}${path}${token ? `?token=${token}` : ''}`;

// Dev aid for machines with no email provider configured. Off unless asked for: a
// link in the logs is a valid credential until it expires.
function logDevLink(label, email, url) {
  if (process.env.LOG_PASSWORD_RESET_LINKS === 'true') console.log(`[DEV] ${label} for ${email}: ${url}`);
}

// QA only: answer with the link instead of (only) emailing it, so a script can
// finish a sign-up or an invitation without reading a mailbox. It defeats the point
// of confirming an email, so the server refuses to start with it on a hosted
// service (see server.js).
const exposeLinks = () => process.env.EXPOSE_ACCOUNT_LINKS === 'true';

module.exports = { TOKEN_PATTERN, newToken, hashToken, frontendUrl, frontendLink, logDevLink, exposeLinks };
