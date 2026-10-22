const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

// The reminder settings migration runs on production (Neon) over a database that already has
// clinics, doctors and appointments (some of them already reminded), which an empty test database never exercises. This builds
// the schema as it was before it, fills it with rows like production's, applies the migration
// and looks at the result. It works in a schema of its own inside the test database.
const SCHEMA = 'reminder_settings_migration_test';
const MIGRATION = '20261025100000_add_reminder_settings';

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

// Production today: two clinics, one appointment already reminded and one still waiting
const LEGACY_ROWS = `
  INSERT INTO "Clinic" (id, name, slug, timezone) VALUES ('clinic-1', 'Consultorio Uno', 'uno', 'America/Guayaquil'), ('clinic-2', 'Consultorio Dos', 'dos', 'Pacific/Galapagos');
  INSERT INTO "Doctor" (id, name, email, password, role, "clinicId") VALUES ('doc-1', 'Dr. Uno', 'uno@x.test', 'hash', 'doctor', 'clinic-1');
  INSERT INTO "Patient" (id, name, phone, "clinicId") VALUES ('pat-1', 'Paciente 1', '+593900000001', 'clinic-1');
  INSERT INTO "Appointment" (id, date, time, status, "doctorId", "patientId", "clinicId", "reminderSentAt") VALUES
    ('ap-sent', '2030-01-14', '09:00', 'confirmed', 'doc-1', 'pat-1', 'clinic-1', '2030-01-13 10:00:00'),
    ('ap-owed', '2030-01-15', '09:00', 'scheduled', 'doc-1', 'pat-1', 'clinic-1', NULL);
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

describe('reminder settings migration on a database that already has data', () => {
  it('leaves every existing clinic reminding exactly as before: on, 24 hours, WhatsApp and email, nothing added', async () => {
    const clinics = await q(`SELECT id, "reminderEnabled", "reminderHours", "secondReminderHours", "reminderWhatsapp", "reminderEmail", address, "reminderIndications" FROM "Clinic" ORDER BY id`);

    expect(clinics).toEqual(
      ['clinic-1', 'clinic-2'].map((id) => ({
        id,
        reminderEnabled: true,
        reminderHours: 24,
        secondReminderHours: null,
        reminderWhatsapp: true,
        reminderEmail: true,
        address: null,
        reminderIndications: null
      }))
    );
  }, 60000);

  it('keeps which appointments were already reminded, and adds the second reminder date empty', async () => {
    const rows = await q(`SELECT id, status, "reminderSentAt" IS NOT NULL AS reminded, "secondReminderSentAt" FROM "Appointment" ORDER BY id`);

    expect(rows).toEqual([
      { id: 'ap-owed', status: 'scheduled', reminded: false, secondReminderSentAt: null },
      { id: 'ap-sent', status: 'confirmed', reminded: true, secondReminderSentAt: null }
    ]);
  }, 60000);

  it('keeps the timezone and name of each clinic', async () => {
    expect(await q(`SELECT id, name, timezone FROM "Clinic" ORDER BY id`)).toEqual([
      { id: 'clinic-1', name: 'Consultorio Uno', timezone: 'America/Guayaquil' },
      { id: 'clinic-2', name: 'Consultorio Dos', timezone: 'Pacific/Galapagos' }
    ]);
  }, 60000);

  it('lets code from before the migration keep working: a clinic and an appointment written without the new columns', async () => {
    runSql(`
      INSERT INTO "Clinic" (id, name, slug) VALUES ('clinic-old', 'Escrito por la versión vieja', 'vieja');
      INSERT INTO "Appointment" (id, date, time, status, "doctorId", "patientId", "clinicId") VALUES ('ap-old', '2030-01-16', '11:00', 'pending_approval', 'doc-1', 'pat-1', 'clinic-1');
    `);

    expect(await q(`SELECT "reminderEnabled", "reminderHours" FROM "Clinic" WHERE id = 'clinic-old'`)).toEqual([{ reminderEnabled: true, reminderHours: 24 }]);
    expect(await q(`SELECT "secondReminderSentAt" FROM "Appointment" WHERE id = 'ap-old'`)).toEqual([{ secondReminderSentAt: null }]);
  }, 60000);
});
