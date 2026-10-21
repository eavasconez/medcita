const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const notificationService = require('./notificationService');
const { recordAccountEvent } = require('./auditLog');
const { TOKEN_PATTERN, newToken, hashToken, frontendLink, logDevLink } = require('../utils/tokens');
const { randomSlug } = require('../utils/slug');

const SIGNUP_TTL_HOURS = 24;
const BCRYPT_ROUNDS = 10;
const MAX_SLUG_ATTEMPTS = 3;
const CLINIC_SELECT = { id: true, name: true, timezone: true };

// Any link that is malformed, unknown, expired, already used or no longer valid
// (its email got an account in the meantime). Callers must not tell them apart.
class InvalidSignupLinkError extends Error {}

/**
 * Start a sign-up for an (already validated and normalized) person and clinic.
 * Nothing is created yet: the person gets an email with a link, and the clinic and
 * its first admin appear when the link is used (confirmSignup).
 *
 * When the email already has an account, nobody gets a confirmation: that account's
 * owner is told instead. The caller answers the same either way, so the sign-up
 * form never reveals which emails are registered.
 *
 * Resolves to { url } with the confirmation link when one was created, else null.
 */
async function requestSignup({ name, email, password, clinicName }) {
  const existing = await prisma.doctor.findUnique({ where: { email }, select: { name: true, email: true } });
  if (existing) {
    await notificationService.sendAccountAlreadyExists({
      doctor: existing,
      loginUrl: frontendLink('/login'),
      resetUrl: frontendLink('/forgot-password')
    });
    return null;
  }

  const token = newToken();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + SIGNUP_TTL_HOURS * 60 * 60 * 1000);

  // Only the newest link for an email works: asking again replaces the earlier one.
  await prisma.$transaction([
    prisma.signupRequest.deleteMany({ where: { email } }),
    prisma.signupRequest.create({ data: { tokenHash: hashToken(token), name, email, clinicName, passwordHash, expiresAt } })
  ]);

  const url = frontendLink('/verify-email', token);
  logDevLink('Sign-up confirmation link', email, url);
  await notificationService.sendSignupConfirmation({ name, email, clinicName, url, expiresInHours: SIGNUP_TTL_HOURS });
  return { url };
}

/**
 * Use a confirmation link: creates the clinic and its first admin in one
 * transaction and consumes the link. Resolves to the new admin, with its clinic.
 */
async function confirmSignup(token, req) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new InvalidSignupLinkError();

  const request = await prisma.signupRequest.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!request) throw new InvalidSignupLinkError();
  if (request.expiresAt <= new Date()) {
    await prisma.signupRequest.deleteMany({ where: { id: request.id } });
    throw new InvalidSignupLinkError();
  }

  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Deleting and counting is what makes the link single use even when two
        // requests race: only one of them can delete the row.
        const claimed = await tx.signupRequest.deleteMany({ where: { id: request.id, expiresAt: { gt: new Date() } } });
        if (claimed.count !== 1) throw new InvalidSignupLinkError();
        // Any other pending sign-up for the same email dies with this one.
        await tx.signupRequest.deleteMany({ where: { email: request.email } });

        const admin = await tx.doctor.create({
          data: {
            name: request.name,
            email: request.email,
            password: request.passwordHash,
            role: 'admin',
            clinic: { create: { name: request.clinicName, slug: randomSlug(request.clinicName) } }
          },
          include: { clinic: { select: CLINIC_SELECT } }
        });
        // The link signs the new admin in
        await recordAccountEvent(tx, req, admin, 'login');
        return admin;
      });
    } catch (err) {
      if (err.code === 'P2002') {
        const target = err.meta?.target ?? [];
        if (target.includes('slug') && attempt < MAX_SLUG_ATTEMPTS) continue;
        // The email got an account between the request and the link
        if (target.includes('email')) throw new InvalidSignupLinkError();
      }
      throw err;
    }
  }
}

// The register endpoint answers first and does the work afterwards, so its
// response time can't reveal whether an email already has an account. Those
// background jobs are tracked so tests (and a graceful shutdown) can wait for them.
const inFlight = new Set();

function requestSignupInBackground(details) {
  const job = requestSignup(details)
    .catch((err) => console.error('Sign-up request failed:', err.message))
    .finally(() => inFlight.delete(job));
  inFlight.add(job);
}

const waitForBackgroundWork = () => Promise.allSettled([...inFlight]);

module.exports = {
  SIGNUP_TTL_HOURS,
  InvalidSignupLinkError,
  requestSignup,
  requestSignupInBackground,
  confirmSignup,
  waitForBackgroundWork
};
