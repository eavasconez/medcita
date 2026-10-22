const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

// The patient record migration runs on production (Neon) over a database that already has
// clinics, doctors and appointments, which an empty test database never exercises. This builds
// the schema as it was before it, fills it with rows like production's, applies the migration
// and looks at the result. It works in a schema of its own inside the test database.
const SCHEMA = 'patient_record_migration_test';
const MIGRATION = '20261027100000_add_patient_record_fields';

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

// Production today: patients of two clinics, one of them with appointments and a consent
const LEGACY_ROWS = `
  INSERT INTO "Clinic" (id, name, slug) VALUES ('clinic-1', 'Consultorio Uno', 'uno'), ('clinic-2', 'Consultorio Dos', 'dos');
  INSERT INTO "Doctor" (id, name, email, password, role, "clinicId") VALUES ('doc-1', 'Dr. Uno', 'uno@x.test', 'hash', 'doctor', 'clinic-1');
  INSERT INTO "Patient" (id, name, phone, email, cedula, "clinicId") VALUES
    ('pat-1', 'Paciente 1', '+593900000001', 'uno@example.test', '1712345678', 'clinic-1'),
    ('pat-2', 'Paciente 2', '+593900000002', NULL, NULL, 'clinic-1'),
    ('pat-3', 'Paciente 3', '+593900000001', NULL, NULL, 'clinic-2');
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

const NEW_COLUMNS = [
  'birthDate', 'sex', 'address', 'occupation', 'emergencyContactName', 'emergencyContactPhone',
  'insuranceProvider', 'insuranceNumber', 'guardianName', 'guardianCedula', 'guardianPhone', 'guardianRelationship'
];

describe('patient record migration on a database that already has data', () => {
  it('keeps every patient as it was, with the new fields empty', async () => {
    const rows = await q(`SELECT id, name, phone, email, cedula, "clinicId", ${NEW_COLUMNS.map((c) => `"${c}"`).join(', ')} FROM "Patient" ORDER BY id`);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: 'pat-1', name: 'Paciente 1', phone: '+593900000001', email: 'uno@example.test', cedula: '1712345678', clinicId: 'clinic-1' });
    expect(rows[2]).toMatchObject({ id: 'pat-3', clinicId: 'clinic-2' });
    for (const row of rows) for (const column of NEW_COLUMNS) expect(row[column]).toBeNull();
  }, 60000);

  it('leaves the appointments alone', async () => {
    expect(await q(`SELECT id, date, time, status, notes, "patientId" FROM "Appointment"`)).toEqual([
      { id: 'ap-1', date: '2030-01-14', time: '09:00', status: 'confirmed', notes: 'Dolor de cabeza', patientId: 'pat-1' }
    ]);
  }, 60000);

  it('stores the record of a patient that already existed', async () => {
    runSql(`UPDATE "Patient" SET "birthDate" = '2015-03-09', sex = 'female', "guardianName" = 'Ana Perez' WHERE id = 'pat-1';`);

    expect(await q(`SELECT "birthDate", sex, "guardianName", phone FROM "Patient" WHERE id = 'pat-1'`)).toEqual([
      { birthDate: '2015-03-09', sex: 'female', guardianName: 'Ana Perez', phone: '+593900000001' }
    ]);
  }, 60000);

  it('keeps the phone unique per clinic, as before', async () => {
    expect(() => runSql(`INSERT INTO "Patient" (id, name, phone, "clinicId") VALUES ('pat-4', 'Repetido', '+593900000001', 'clinic-1');`)).toThrow(/unique|duplicate/i);
  }, 60000);
});
