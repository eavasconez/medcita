const prisma = require('../config/prisma');

// P2034 (serialization failure) can come from any write conflict in the
// transaction, not just a slot clash, so retry a bounded number of times
// instead of assuming it always means "appointment already booked". If the
// conflict is real, the retried attempt's own explicit check throws
// ScheduleConflictError with the correct message; P2034 only reaches the
// caller if it persists across every retry.
async function runSerializableTransaction(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (err) {
      if (err.code === 'P2034' && attempt < maxAttempts) continue;
      throw err;
    }
  }
}

module.exports = { runSerializableTransaction };
