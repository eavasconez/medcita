const prisma = require('../../src/config/prisma');

// Safe: setupEnv.js guarantees DATABASE_URL points at a "*_test" database.
async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Appointment", "Availability", "Patient", "Doctor" RESTART IDENTITY CASCADE'
  );
}

module.exports = { prisma, resetDb };
