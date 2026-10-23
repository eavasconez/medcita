const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

// The clinical background migration runs on production (Neon) over a database that already has
// clinics, doctors and appointments, which an empty test database never exercises. This builds
// the schema as it was before it, fills it with rows like production's, applies the migration
// and looks at the result. It works in a schema of its own inside the test database.
const SCHEMA = 'clinical_background_migration_test';
const MIGRATION = '20261028100000_add_clinical_background';

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

// Production today: patients of two clinics, one with appointments, and the S10-02 record fields
const LEGACY_ROWS = `
  INSERT INTO "Clinic" (id, name, slug) VALUES ('clinic-1', 'Consultorio Uno', 'uno'), ('clinic-2', 'Consultorio Dos', 'dos');
  INSERT INTO "Doctor" (id, name, email, password, role, "clinicId") VALUES ('doc-1', 'Dr. Uno', 'uno@x.test', 'hash', 'doctor', 'clinic-1');
  INSERT INTO "Patient" (id, name, phone, email, cedula, "birthDate", "clinicId") VALUES
    ('pat-1', 'Paciente 1', '+593900000001', 'uno@example.test', '1712345678', '1985-06-15', 'clinic-1'),
    ('pat-2', 'Paciente 2', '+593900000002', NULL, NULL, NULL, 'clinic-1'),
    ('pat-3', 'Paciente 3', '+593900000001', NULL, NULL, NULL, 'clinic-2');
  INSERT INTO "AppointmentType" (id, name, "durationMinutes", color, "isDefault", "clinicId") VALUES ('type-1', 'Consultation', 30, '#0ea5e9', true, 'clinic-1');
  INSERT INTO "Appointment" (id, date, time, status, notes, "doctorId", "patientId", "clinicId", "typeId") VALUES
    ('ap-1', '2030-01-14', '09:00', 'confirmed', 'Dolor de cabeza', 'doc-1', 'pat-1', 'clinic-1', 'type-1');
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

describe('clinical background migration on a database that already has data', () => {
  it('only adds three empty tables: every existing row is as it was', async () => {
    for (const table of ['PatientAllergy', 'PatientMedication', 'PatientBackground']) {
      expect(await q(`SELECT count(*)::int AS n FROM "${table}"`)).toEqual([{ n: 0 }]);
    }
    expect(await q('SELECT id, "birthDate" FROM "Patient" ORDER BY id')).toEqual([
      { id: 'pat-1', birthDate: '1985-06-15' },
      { id: 'pat-2', birthDate: null },
      { id: 'pat-3', birthDate: null }
    ]);
    expect(await q('SELECT id, notes FROM "Appointment"')).toEqual([{ id: 'ap-1', notes: 'Dolor de cabeza' }]);
  }, 60000);

  it('takes an allergy, a medication and a history line for an existing patient', async () => {
    runSql(`
      INSERT INTO "PatientAllergy" (id, "updatedAt", "clinicId", "patientId", substance, "recordedById", "recordedByName") VALUES ('al-1', now(), 'clinic-1', 'pat-1', 'Penicilina', 'doc-1', 'Dr. Uno');
      INSERT INTO "PatientMedication" (id, "updatedAt", "clinicId", "patientId", name, "recordedById", "recordedByName") VALUES ('me-1', now(), 'clinic-1', 'pat-1', 'Metformina', 'doc-1', 'Dr. Uno');
      INSERT INTO "PatientBackground" (id, "updatedAt", "clinicId", "patientId", category, description, "recordedById", "recordedByName") VALUES ('ba-1', now(), 'clinic-1', 'pat-1', 'surgical', 'Apendicectomía', 'doc-1', 'Dr. Uno');
    `);

    expect(await q(`SELECT substance, active FROM "PatientAllergy"`)).toEqual([{ substance: 'Penicilina', active: true }]);
  }, 60000);

  it('refuses a row for a patient of another clinic', async () => {
    expect(() => runSql(`INSERT INTO "PatientAllergy" (id, "updatedAt", "clinicId", "patientId", substance, "recordedById", "recordedByName") VALUES ('al-x', now(), 'clinic-2', 'pat-1', 'x', 'doc-1', 'Dr. Uno');`)).toThrow(/foreign key|violates/i);
  }, 60000);

  it('refuses to delete a patient that has clinical data', async () => {
    expect(() => runSql(`DELETE FROM "Patient" WHERE id = 'pat-1';`)).toThrow(/foreign key|violates/i);
    expect(await q(`SELECT count(*)::int AS n FROM "Patient" WHERE id = 'pat-1'`)).toEqual([{ n: 1 }]);
  }, 60000);
});
