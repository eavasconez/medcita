const prisma = require('../../src/config/prisma');
const { resetRateLimits } = require('../../src/middleware/rateLimiters');

// Clean slate before each test: empty tables and no rate limit history (the
// limiters keep their counters in memory, so a test hammering /login would
// otherwise lock out the tests that run after it).
// Safe: setupEnv.js guarantees DATABASE_URL points at a "*_test" database.
async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "PasswordResetToken", "Appointment", "Availability", "Patient", "Doctor", "Clinic" RESTART IDENTITY CASCADE'
  );
  await resetRateLimits();
}

module.exports = { prisma, resetDb };
