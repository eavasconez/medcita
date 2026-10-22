const crypto = require('crypto');
const prisma = require('../config/prisma');

// Where the rate limits keep their counters (S9-08): in Postgres, not in the memory of one
// server process. A deploy (or a second instance) used to start every count from zero, which
// handed an attacker a fresh set of guesses each time; now the count is in the database.
//
// It plugs into express-rate-limit as its `store`. Each limiter has its own `prefix`, so the
// same email can be counted by the login limit and by the password reset limit separately.
// The client (an email or an IP) is never written in the clear: the key is a SHA-256 of it.
//
// The window is decided by the database clock, in one atomic statement, so two requests (or two
// instances) counting at the same moment never lose a hit.

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// Timestamps of the table are UTC without a zone; this is the database's "now" in the same terms
const NOW = 'now() AT TIME ZONE \'UTC\'';

class PostgresStore {
  // A key counted by one instance of the store is seen by every other one
  localKeys = false;

  constructor({ prefix, db = prisma }) {
    this.prefix = prefix;
    this.db = db;
  }

  // express-rate-limit tells the store how long a window is
  init(options) {
    this.windowMs = options.windowMs;
  }

  keyOf(client) {
    return `${this.prefix}:${hash(client)}`;
  }

  async increment(client) {
    const key = this.keyOf(client);
    const windowMs = this.windowMs;
    // A row whose window ended starts over at one hit; otherwise it counts up inside its window
    const [row] = await this.db.$queryRawUnsafe(
      `INSERT INTO "RateLimitCounter" ("key", "hits", "resetAt")
       VALUES ($1, 1, (${NOW}) + $2::int * interval '1 millisecond')
       ON CONFLICT ("key") DO UPDATE SET
         "hits" = CASE WHEN "RateLimitCounter"."resetAt" <= (${NOW}) THEN 1 ELSE "RateLimitCounter"."hits" + 1 END,
         "resetAt" = CASE WHEN "RateLimitCounter"."resetAt" <= (${NOW}) THEN (${NOW}) + $2::int * interval '1 millisecond' ELSE "RateLimitCounter"."resetAt" END
       RETURNING "hits", "resetAt"`,
      key,
      windowMs
    );
    return { totalHits: row.hits, resetTime: row.resetAt };
  }

  async get(client) {
    const row = await this.db.rateLimitCounter.findFirst({ where: { key: this.keyOf(client), resetAt: { gt: new Date() } } });
    return row ? { totalHits: row.hits, resetTime: row.resetAt } : undefined;
  }

  // Taken back when a request turns out not to count (a successful login does not count as a failed one)
  async decrement(client) {
    await this.db.$executeRawUnsafe(
      `UPDATE "RateLimitCounter" SET "hits" = GREATEST("hits" - 1, 0) WHERE "key" = $1`,
      this.keyOf(client)
    );
  }

  async resetKey(client) {
    await this.db.rateLimitCounter.deleteMany({ where: { key: this.keyOf(client) } });
  }

  async resetAll() {
    await this.db.rateLimitCounter.deleteMany({ where: { key: { startsWith: `${this.prefix}:` } } });
  }
}

// Rows whose window already ended are dead (the next hit would start over anyway): remove them.
// Returns how many went.
async function purgeExpiredCounters(db = prisma) {
  const removed = await db.$executeRawUnsafe(`DELETE FROM "RateLimitCounter" WHERE "resetAt" <= (${NOW})`);
  return removed;
}

module.exports = { PostgresStore, purgeExpiredCounters };
