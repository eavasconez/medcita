const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const notificationService = require('./notificationService');
const { recordAccountEvent } = require('./auditLog');
const { TOKEN_PATTERN, newToken, hashToken, frontendLink, logDevLink } = require('../utils/tokens');

const RESET_TOKEN_TTL_MINUTES = 60;
const BCRYPT_ROUNDS = 10;

class InvalidResetTokenError extends Error {}

/**
 * Create a reset link for the account with this (already normalized) email and
 * email it. Does nothing when there is no such account. Resolves to true only if
 * an email was delivered.
 */
async function requestPasswordReset(email) {
  const doctor = await prisma.doctor.findUnique({ where: { email }, select: { id: true, name: true, email: true, clinicId: true } });
  if (!doctor) return false;

  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  // Only the newest link works: asking again replaces any earlier, unused one.
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { doctorId: doctor.id } }),
    prisma.passwordResetToken.create({ data: { doctorId: doctor.id, tokenHash: hashToken(token), expiresAt } })
  ]);

  const resetUrl = frontendLink('/reset-password', token);
  logDevLink('Password reset link', doctor.email, resetUrl);

  return notificationService.sendPasswordReset({ doctor, resetUrl, expiresInMinutes: RESET_TOKEN_TTL_MINUTES });
}

/**
 * Exchange a valid reset token for a new password. Throws InvalidResetTokenError
 * for any token that is malformed, unknown, expired or already used (callers must
 * not tell those apart). Resolves to the account { id, email }.
 */
async function resetPassword(token, newPassword, req) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new InvalidResetTokenError();

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record) throw new InvalidResetTokenError();
  if (record.expiresAt <= new Date()) {
    await prisma.passwordResetToken.deleteMany({ where: { id: record.id } });
    throw new InvalidResetTokenError();
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    // Deleting and counting is what makes the link single use even when two requests
    // race: only one of them can delete the row, the other one matches nothing.
    const claimed = await tx.passwordResetToken.deleteMany({
      where: { id: record.id, expiresAt: { gt: new Date() } }
    });
    if (claimed.count !== 1) throw new InvalidResetTokenError();

    const doctor = await tx.doctor.update({
      where: { id: record.doctorId },
      // passwordChangedAt signs out every session opened with the old password
      data: { password: passwordHash, passwordChangedAt: new Date() },
      select: { id: true, email: true, name: true, role: true, clinicId: true }
    });
    await recordAccountEvent(tx, req, doctor, 'password_reset');
    // Any other link still floating around for this account dies with this one.
    await tx.passwordResetToken.deleteMany({ where: { doctorId: record.doctorId } });
    return doctor;
  });
}

// The forgot-password endpoint answers first and does the work afterwards, so its
// response time can't reveal whether an email has an account. Those background
// jobs are tracked so tests (and a graceful shutdown) can wait for them.
const inFlight = new Set();

function requestPasswordResetInBackground(email) {
  const job = requestPasswordReset(email)
    .catch((err) => console.error('Password reset request failed:', err.message))
    .finally(() => inFlight.delete(job));
  inFlight.add(job);
}

const waitForBackgroundWork = () => Promise.allSettled([...inFlight]);

module.exports = {
  RESET_TOKEN_TTL_MINUTES,
  InvalidResetTokenError,
  hashToken,
  requestPasswordReset,
  requestPasswordResetInBackground,
  resetPassword,
  waitForBackgroundWork
};
