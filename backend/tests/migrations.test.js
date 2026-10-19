const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

const backendDir = path.join(__dirname, '..');
const migrationsDir = path.join(backendDir, 'prisma', 'migrations');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const migrationNames = () =>
  fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

afterAll(() => prisma.$disconnect());

// globalSetup builds the test database with `prisma migrate deploy`, so what it
// holds is exactly what the migrations create (and what production will get).
describe('prisma migrations', () => {
  it('create exactly the schema declared in schema.prisma', () => {
    const diff = spawnSync(
      npx,
      [
        'prisma', 'migrate', 'diff',
        '--from-schema-datasource', 'prisma/schema.prisma',
        '--to-schema-datamodel', 'prisma/schema.prisma',
        '--script', '--exit-code'
      ],
      { cwd: backendDir, encoding: 'utf8', env: { ...process.env, DATABASE_URL: getTestDatabaseUrl() } }
    );

    if (diff.status !== 0) {
      throw new Error(
        'schema.prisma and prisma/migrations are out of sync (a model changed without its migration).\n' +
          'Create it with `npx prisma migrate dev --name <what_changed>` and commit the new folder together with schema.prisma.\n' +
          `SQL that would bring the migrated database to schema.prisma:\n${diff.stdout}${diff.stderr}`
      );
    }
  }, 60000);

  it('are folders named <timestamp>_<description> with a non-empty migration.sql', () => {
    const names = migrationNames();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      expect(name).toMatch(/^\d{14}_[a-z0-9_]+$/);
      expect(fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8').trim()).not.toBe('');
    }
  });

  it('are all recorded as applied in the test database', async () => {
    const rows = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;

    expect(rows.map((row) => row.migration_name)).toEqual(migrationNames());
    for (const row of rows) {
      expect(row.finished_at).not.toBeNull();
      expect(row.rolled_back_at).toBeNull();
    }
  });
});
