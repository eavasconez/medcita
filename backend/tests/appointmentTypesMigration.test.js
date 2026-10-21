const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

// The appointment types migration runs on production (Neon) over appointments that already
// exist, which an empty test database never exercises. This builds the schema as it was
// before it, fills it with rows like production's, applies the migration and looks at the
// result. It works in a schema of its own inside the test database.
const SCHEMA = 'appointment_types_migration_test';
const MIGRATION = '20261023100000_add_appointment_types';

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

// Production today: two clinics, doctors, patients and appointments, none with a type
const LEGACY_ROWS = `
  INSERT INTO "Clinic" (id, name, slug) VALUES ('clinic-1', 'Consultorio Uno', 'uno'), ('clinic-2', 'Consultorio Dos', 'dos');
  INSERT INTO "Clinic" (id, name, slug, timezone) VALUES ('clinic-3', 'Sin citas', 'tres', 'Pacific/Galapagos');
  INSERT INTO "Doctor" (id, name, email, password, role, "clinicId") VALUES
    ('doc-1', 'Dr. Uno', 'uno@x.test', 'hash', 'doctor', 'clinic-1'),
    ('doc-2', 'Dra. Dos', 'dos@x.test', 'hash', 'doctor', 'clinic-2');
  INSERT INTO "Patient" (id, name, phone, "clinicId") VALUES
    ('pat-1', 'Paciente 1', '+593900000001', 'clinic-1'),
    ('pat-2', 'Paciente 2', '+593900000001', 'clinic-2');
  INSERT INTO "Appointment" (id, date, time, status, "doctorId", "patientId", "clinicId") VALUES
    ('ap-1', '2030-01-14', '09:00', 'confirmed', 'doc-1', 'pat-1', 'clinic-1'),
    ('ap-2', '2030-01-14', '09:30', 'cancelled', 'doc-1', 'pat-1', 'clinic-1'),
    ('ap-3', '2030-01-15', '10:00', 'scheduled', 'doc-2', 'pat-2', 'clinic-2');
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

describe('appointment types migration on a database that already has appointments', () => {
  it('gives every clinic, with or without appointments, exactly one default 30-minute type', async () => {
    const types = await q(`SELECT "clinicId", name, "durationMinutes", color, "isDefault", active FROM "AppointmentType" ORDER BY "clinicId"`);

    expect(types).toEqual(
      ['clinic-1', 'clinic-2', 'clinic-3'].map((clinicId) => ({
        clinicId,
        name: 'Consultation',
        durationMinutes: 30,
        color: '#0ea5e9',
        isDefault: true,
        active: true
      }))
    );
  }, 60000);

  it('links every existing appointment, cancelled ones too, to its own clinic\'s default type, at 30 minutes', async () => {
    const rows = await q(`
      SELECT a.id, a."durationMinutes", a."clinicId" = t."clinicId" AS same_clinic, t."isDefault"
      FROM "Appointment" a JOIN "AppointmentType" t ON t.id = a."typeId" ORDER BY a.id
    `);

    expect(rows).toEqual([
      { id: 'ap-1', durationMinutes: 30, same_clinic: true, isDefault: true },
      { id: 'ap-2', durationMinutes: 30, same_clinic: true, isDefault: true },
      { id: 'ap-3', durationMinutes: 30, same_clinic: true, isDefault: true }
    ]);
  }, 60000);

  it('keeps every appointment as it was', async () => {
    const rows = await q(`SELECT id, date, time, status, "doctorId", "patientId", "clinicId" FROM "Appointment" ORDER BY id`);

    expect(rows).toEqual([
      { id: 'ap-1', date: '2030-01-14', time: '09:00', status: 'confirmed', doctorId: 'doc-1', patientId: 'pat-1', clinicId: 'clinic-1' },
      { id: 'ap-2', date: '2030-01-14', time: '09:30', status: 'cancelled', doctorId: 'doc-1', patientId: 'pat-1', clinicId: 'clinic-1' },
      { id: 'ap-3', date: '2030-01-15', time: '10:00', status: 'scheduled', doctorId: 'doc-2', patientId: 'pat-2', clinicId: 'clinic-2' }
    ]);
  }, 60000);

  it('lets code from before the migration keep booking: no type needed, 30 minutes by default', async () => {
    runSql(`INSERT INTO "Appointment" (id, date, time, status, "doctorId", "patientId", "clinicId") VALUES ('ap-old', '2030-01-16', '11:00', 'pending_approval', 'doc-1', 'pat-1', 'clinic-1');`);

    expect(await q(`SELECT "typeId", "durationMinutes" FROM "Appointment" WHERE id = 'ap-old'`)).toEqual([{ typeId: null, durationMinutes: 30 }]);
  }, 60000);

  it('refuses a type of another clinic, and a second default name in one clinic', async () => {
    const [other] = await q(`SELECT id FROM "AppointmentType" WHERE "clinicId" = 'clinic-2'`);

    expect(() => runSql(`UPDATE "Appointment" SET "typeId" = '${other.id}' WHERE id = 'ap-1';`)).toThrow(/foreign key|violates/i);
    expect(() =>
      runSql(`INSERT INTO "AppointmentType" (id, name, "durationMinutes", color, "clinicId") VALUES ('dup', 'Consultation', 20, '#000000', 'clinic-1');`)
    ).toThrow(/duplicate key|unique/i);
  }, 60000);

  it('cannot delete a type that appointments use', async () => {
    const [mine] = await q(`SELECT id FROM "AppointmentType" WHERE "clinicId" = 'clinic-1'`);

    expect(() => runSql(`DELETE FROM "AppointmentType" WHERE id = '${mine.id}';`)).toThrow(/foreign key|violates/i);
  }, 60000);
});
