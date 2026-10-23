const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

// The diagnoses migration runs on production (Neon) over a database that already has
// clinics, doctors and appointments, which an empty test database never exercises. This builds
// the schema as it was before it, fills it with rows like production's, applies the migration
// and looks at the result. It works in a schema of its own inside the test database.
const SCHEMA = 'diagnoses_migration_test';
const MIGRATION = '20261030100000_add_diagnoses';

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

// Production today: patients of two clinics, one with appointments, and a consultation note of S10-04
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
  INSERT INTO "ConsultationNote" (id, "updatedAt", "clinicId", "patientId", "appointmentId", "authorId", "authorName", subjective) VALUES
    ('n-1', now(), 'clinic-1', 'pat-1', 'ap-1', 'doc-1', 'Dr. Uno', 'Cefalea');
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

describe('diagnoses migration on a database that already has data', () => {
  it('only adds two empty tables: the notes and everything else are as they were', async () => {
    expect(await q('SELECT count(*)::int AS n FROM "DiagnosisCode"')).toEqual([{ n: 0 }]);
    expect(await q('SELECT count(*)::int AS n FROM "ConsultationDiagnosis"')).toEqual([{ n: 0 }]);
    expect(await q('SELECT id, status, subjective FROM "ConsultationNote"')).toEqual([{ id: 'n-1', status: 'draft', subjective: 'Cefalea' }]);
    expect(await q('SELECT count(*)::int AS n FROM "Patient"')).toEqual([{ n: 3 }]);
  }, 60000);

  it('takes catalogue rows and a diagnosis for the existing note', async () => {
    runSql(`
      INSERT INTO "DiagnosisCode" (id, code, "codeKey", name, "searchText", level, source) VALUES ('c-1', 'T90.0', 'T900', 'DIAGNOSTICO', 'diagnostico', 'subcategory', 'msp-rdacaa');
      INSERT INTO "ConsultationDiagnosis" (id, "clinicId", "patientId", "noteId", code, name, "recordedById", "recordedByName") VALUES ('d-1', 'clinic-1', 'pat-1', 'n-1', 'T90.0', 'DIAGNOSTICO', 'doc-1', 'Dr. Uno');
    `);

    expect(await q('SELECT selectable, version FROM "DiagnosisCode"')).toEqual([{ selectable: true, version: 'CIE10' }]);
    expect(await q('SELECT kind, certainty FROM "ConsultationDiagnosis"')).toEqual([{ kind: 'secondary', certainty: 'presumptive' }]);
  }, 60000);

  it('keeps the catalogue code unique, and one code per note', async () => {
    expect(() => runSql(`INSERT INTO "DiagnosisCode" (id, code, "codeKey", name, "searchText", level, source) VALUES ('c-2', 'T90.0', 'T900', 'x', 'x', 'subcategory', 'other');`)).toThrow(/unique|duplicate/i);
    expect(() => runSql(`INSERT INTO "ConsultationDiagnosis" (id, "clinicId", "patientId", "noteId", code, name, "recordedById", "recordedByName") VALUES ('d-2', 'clinic-1', 'pat-1', 'n-1', 'T90.0', 'x', 'doc-1', 'Dr. Uno');`)).toThrow(/unique|duplicate/i);
  }, 60000);

  it('allows several free-text diagnoses in one note (no code)', async () => {
    runSql(`
      INSERT INTO "ConsultationDiagnosis" (id, "clinicId", "patientId", "noteId", name, "recordedById", "recordedByName") VALUES
        ('d-3', 'clinic-1', 'pat-1', 'n-1', 'Cefalea', 'doc-1', 'Dr. Uno'),
        ('d-4', 'clinic-1', 'pat-1', 'n-1', 'Mareo', 'doc-1', 'Dr. Uno');
    `);
    expect(await q(`SELECT count(*)::int AS n FROM "ConsultationDiagnosis" WHERE code IS NULL`)).toEqual([{ n: 2 }]);
  }, 60000);

  it('refuses a diagnosis for a patient of another clinic and the deletion of a note that has diagnoses', async () => {
    expect(() => runSql(`INSERT INTO "ConsultationDiagnosis" (id, "clinicId", "patientId", "noteId", name, "recordedById", "recordedByName") VALUES ('d-5', 'clinic-2', 'pat-1', 'n-1', 'x', 'doc-1', 'Dr. Uno');`)).toThrow(/foreign key|violates/i);
    expect(() => runSql(`DELETE FROM "ConsultationNote" WHERE id = 'n-1';`)).toThrow(/foreign key|violates/i);
  }, 60000);
});
