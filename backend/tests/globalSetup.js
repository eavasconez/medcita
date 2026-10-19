// Runs once before the whole suite: validates the test database target and builds
// its schema from scratch with `prisma migrate deploy`, the command that builds
// production, so the suite always runs on what the migrations really create.
const path = require('path');
const { execFileSync } = require('child_process');
const { getTestDatabaseUrl, getTestSchemaName } = require('./testDatabase');

const backendDir = path.join(__dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function prisma(args, { url, input } = {}) {
  try {
    execFileSync(npx, ['prisma', ...args], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: url },
      input,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    const output = `${err.stdout || ''}${err.stderr || ''}`.trim();
    throw new Error(`Could not prepare the test database (prisma ${args.join(' ')}):\n${output || err.message}`);
  }
}

module.exports = async () => {
  const url = getTestDatabaseUrl();
  const schema = getTestSchemaName(url);

  // Start from an empty schema. `migrate deploy` refuses a database that already has
  // tables but no migration history, e.g. a test database built with `db push` by an
  // older checkout. The name check above makes this safe: it is a throwaway database.
  prisma(['db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], {
    url,
    input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE; CREATE SCHEMA "${schema}";`
  });
  prisma(['migrate', 'deploy'], { url });

  // `migrate deploy` doesn't generate the Prisma client, so do it here: a freshly
  // pulled schema change then works without a separate `prisma generate`.
  prisma(['generate'], { url });
};
