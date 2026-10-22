// Forgets every rate limit counter: `npm run limits:reset`.
//
// The counters of failed logins, password resets and sign-ups live in the database now, so they
// survive restarting the server. When a QA script (Postman, a loop of wrong passwords) has used up
// a limit, this clears it instead of waiting out the window (up to an hour). It only touches the
// counters; it refuses to run against a database that is not local unless it is told the host:
//
//   RATE_LIMIT_RESET_HOST=<host of DATABASE_URL> npm run limits:reset
require('dotenv').config();

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

async function main(env = process.env, out = console.log) {
  const host = hostOf(env.DATABASE_URL);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  if (!host) {
    out('DATABASE_URL is missing or is not a URL.');
    return 1;
  }
  if (!local && env.RATE_LIMIT_RESET_HOST !== host) {
    out(`DATABASE_URL points to ${host}, which is not a local database. Clearing the limits there would let attackers start over. If you really mean it, run: RATE_LIMIT_RESET_HOST=${host} npm run limits:reset`);
    return 1;
  }

  const prisma = require('../src/config/prisma');
  try {
    const { count } = await prisma.rateLimitCounter.deleteMany();
    out(`Cleared ${count} rate limit counter${count === 1 ? '' : 's'} on ${host}.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main };
