const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

// The rate limit counters migration runs on production (Neon) over a database that already has
// clinics, doctors and appointments, which an empty test database never exercises. This builds
// the schema as it was before it, fills it with rows like production's, applies the migration
// and looks at the result. It works in a schema of its own inside the test database.
const SCHEMA = 'rate_limit_counters_migration_test';
const MIGRATION = '20261026100000_add_rate_limit_counters';

const backendDir = path.join(__dirname, '..');
const migrationsDir = path.join(backendDir, 'prisma', 'migrations');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const migrationSql = (name) => fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
const migrationsBefore = () =>
  fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < MIGRATION)
    .map((entry) => entry.name)
    .sort();

function urlForSchema(schema) {
  const url = new URL(getTestDatabaseUrl());
  url.searchParams.set('schema', schema);
  return url.toString();
}

function runSql(sql, { schema = SCHEMA } = {}) {
  try {
    execFileSync(npx, ['prisma', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: urlForSchema(schema) },
      input: `SET search_path TO "${schema}";\n${sql}`,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    throw new Error(`SQL failed in schema ${schema}:\n${err.stdout || ''}${err.stderr || ''}`.trim());
  }
}

const q = async (sql) => {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL search_path TO "${SCHEMA}"`),
    prisma.$queryRawUnsafe(sql)
  ]);
  return rows;
};

// Production today: a clinic with a doctor, a patient and an appointment
const LEGACY_ROWS = `
  INSERT INTO "Clinic" (id, name, slug) VALUES ('clinic-1', 'Consultorio Uno', 'uno');
  INSERT INTO "Doctor" (id, name, email, password, role, "clinicId") VALUES ('doc-1', 'Dr. Uno', 'uno@x.test', 'hash', 'doctor', 'clinic-1');
  INSERT INTO "Patient" (id, name, phone, "clinicId") VALUES ('pat-1', 'Paciente 1', '+593900000001', 'clinic-1');
  INSERT INTO "Appointment" (id, date, time, status, "doctorId", "patientId", "clinicId") VALUES ('ap-1', '2030-01-14', '09:00', 'confirmed', 'doc-1', 'pat-1', 'clinic-1');
`;

beforeAll(() => {
  runSql(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE; CREATE SCHEMA "${SCHEMA}";`, { schema: 'public' });
  runSql(migrationsBefore().map(migrationSql).join('\n'));
  runSql(LEGACY_ROWS);
  runSql(migrationSql(MIGRATION));
}, 120000);

afterAll(async () => {
  runSql(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE;`, { schema: 'public' });
  await prisma.$disconnect();
});

describe('rate limit counters migration on a database that already has data', () => {
  it('only adds an empty table: every existing row is as it was', async () => {
    expect(await q('SELECT count(*)::int AS n FROM "RateLimitCounter"')).toEqual([{ n: 0 }]);
    expect(await q('SELECT id, name FROM "Clinic"')).toEqual([{ id: 'clinic-1', name: 'Consultorio Uno' }]);
    expect(await q('SELECT count(*)::int AS n FROM "Doctor"')).toEqual([{ n: 1 }]);
    expect(await q('SELECT id, status FROM "Appointment"')).toEqual([{ id: 'ap-1', status: 'confirmed' }]);
  }, 60000);

  it('takes a counter, and counts it up with the same statement the app uses', async () => {
    const upsert = (hits) => `
      INSERT INTO "RateLimitCounter" ("key", "hits", "resetAt") VALUES ('login-email:abc', 1, (now() AT TIME ZONE 'UTC') + 900000::int * interval '1 millisecond')
      ON CONFLICT ("key") DO UPDATE SET "hits" = "RateLimitCounter"."hits" + 1;
      SELECT ${hits};`;
    runSql(upsert(1));
    runSql(upsert(2));

    expect(await q(`SELECT "hits" FROM "RateLimitCounter" WHERE "key" = 'login-email:abc'`)).toEqual([{ hits: 2 }]);
  }, 60000);

  it('does not let one key be there twice', async () => {
    expect(() =>
      runSql(`INSERT INTO "RateLimitCounter" ("key", "hits", "resetAt") VALUES ('login-email:abc', 1, now());`)
    ).toThrow(/duplicate key|unique/i);
  }, 60000);
});
