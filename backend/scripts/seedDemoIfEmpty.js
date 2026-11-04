// Loads the demo data the first time a DEMO server is deployed: `npm run seed:demo`.
//
// A new database (a new Railway Postgres, for example) is born with its tables but no rows, and
// `prisma migrate deploy` never loads the seed. This step runs right after the migrations in the
// deploy and loads it for you, but only when ALL of this is true:
//
//   1. DEMO_SEED is exactly "true" (set it on the demo only: production never has it), and
//   2. the database has no clinic, doctor or patient at all.
//
// Anything else does nothing, so it is safe to leave in every deploy: once there is data (the demo's
// or a real person's) it is never touched again. The seed itself DELETES everything before loading,
// which is why it refuses a remote database unless it is told the host; here that host is passed on
// because the two conditions above already say this database is an empty demo.
require('dotenv').config();
const path = require('path');
const { execFileSync } = require('child_process');

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

// Runs prisma/seed.js in its own process, with `env` as its environment (it ends the process on error)
const runSeedProcess = (env) => {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'prisma', 'seed.js')], { stdio: 'inherit', env });
};

async function main(env = process.env, out = console.log, { prisma, runSeed = runSeedProcess } = {}) {
  if (env.DEMO_SEED !== 'true') {
    out('DEMO_SEED is not "true": the demo data is not loaded.');
    return 0;
  }
  const host = hostOf(env.DATABASE_URL);
  if (!host) {
    out('DATABASE_URL is missing or is not a URL.');
    return 1;
  }

  const db = prisma || require('../src/config/prisma');
  try {
    const [clinics, doctors, patients] = await Promise.all([db.clinic.count(), db.doctor.count(), db.patient.count()]);
    if (clinics + doctors + patients > 0) {
      out(`The database at ${host} already has data (${clinics} clinics, ${doctors} users, ${patients} patients): the demo data is not loaded again.`);
      return 0;
    }
    out(`The database at ${host} is empty and DEMO_SEED is "true": loading the demo data.`);
    runSeed({ ...env, SEED_REMOTE_HOST: host });
    return 0;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main };
