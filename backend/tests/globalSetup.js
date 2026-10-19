// Runs once before the whole suite: validates the test database target and
// makes sure its schema matches prisma/schema.prisma.
const path = require('path');
const { execFileSync } = require('child_process');
const { getTestDatabaseUrl } = require('./testDatabase');

module.exports = async () => {
  const url = getTestDatabaseUrl();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  try {
    execFileSync(npx, ['prisma', 'db', 'push', '--skip-generate'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe'
    });
  } catch (err) {
    const output = `${err.stdout || ''}${err.stderr || ''}`.trim();
    throw new Error(`Could not prepare the test database schema (prisma db push):\n${output || err.message}`);
  }
};
