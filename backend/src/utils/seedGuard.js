// The seed script empties every table before loading the demo data. Against a database
// on this machine that is the point; against a remote one (Neon) it can wipe production
// by pointing DATABASE_URL at the wrong branch. So a remote database is only seeded when
// the person names its host in SEED_REMOTE_HOST, which is hard to do by accident.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'db', 'host.docker.internal']);

function checkSeedTarget(databaseUrl, env = process.env) {
  let host;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return { ok: false, host: null, message: 'DATABASE_URL is missing or is not a valid connection string.' };
  }
  if (LOCAL_HOSTS.has(host)) return { ok: true, host };
  if (env.SEED_REMOTE_HOST === host) return { ok: true, host };
  return {
    ok: false,
    host,
    message:
      `The seed DELETES ALL DATA of the database at ${host}. That is not a local database, so it was not touched.\n` +
      `If this really is the database to empty (the staging one, never production), run it again with SEED_REMOTE_HOST=${host}`
  };
}

module.exports = { checkSeedTarget };
