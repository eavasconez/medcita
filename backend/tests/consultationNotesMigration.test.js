const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

// The consultation notes migration runs on production (Neon) over a database that already has
// clinics, doctors and appointments, which an empty test database never exercises. This builds
// the schema as it was before it, fills it with rows like production's, applies the migration
// and looks at the result. It works in a schema of its own inside the test database.
const SCHEMA = 'consultation_notes_migration_test';
const MIGRATION = '20261029100000_add_consultation_notes';

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

// Production today: patients of two clinics, one with appointments, and the clinical background of S10-03
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

describe('consultation notes migration on a database that already has data', () => {
  it('only adds two empty tables: every existing row is as it was', async () => {
    for (const table of ['ConsultationNote', 'ConsultationAddendum']) {
      expect(await q(`SELECT count(*)::int AS n FROM "${table}"`)).toEqual([{ n: 0 }]);
    }
    expect(await q('SELECT id, "patientId", notes FROM "Appointment"')).toEqual([{ id: 'ap-1', patientId: 'pat-1', notes: 'Dolor de cabeza' }]);
    expect(await q('SELECT count(*)::int AS n FROM "Patient"')).toEqual([{ n: 3 }]);
  }, 60000);

  it('takes the note of an existing appointment, with its defaults, and an addendum', async () => {
    runSql(`
      INSERT INTO "ConsultationNote" (id, "updatedAt", "clinicId", "patientId", "appointmentId", "authorId", "authorName") VALUES ('n-1', now(), 'clinic-1', 'pat-1', 'ap-1', 'doc-1', 'Dr. Uno');
      INSERT INTO "ConsultationAddendum" (id, "clinicId", "noteId", text, "authorId", "authorName") VALUES ('ad-1', 'clinic-1', 'n-1', 'Aclaración', 'doc-1', 'Dr. Uno');
    `);

    expect(await q(`SELECT status, revision, subjective, plan, "closedAt" FROM "ConsultationNote"`)).toEqual([
      { status: 'draft', revision: 1, subjective: '', plan: '', closedAt: null }
    ]);
    expect(await q(`SELECT text FROM "ConsultationAddendum"`)).toEqual([{ text: 'Aclaración' }]);
  }, 60000);

  it('one note per appointment', async () => {
    expect(() => runSql(`INSERT INTO "ConsultationNote" (id, "updatedAt", "clinicId", "patientId", "appointmentId", "authorId", "authorName") VALUES ('n-2', now(), 'clinic-1', 'pat-1', 'ap-1', 'doc-1', 'Dr. Uno');`)).toThrow(/unique|duplicate/i);
  }, 60000);

  it('refuses a note for a patient of another clinic', async () => {
    runSql(`INSERT INTO "Appointment" (id, date, time, status, "doctorId", "patientId", "clinicId") VALUES ('ap-2', '2030-01-15', '09:00', 'confirmed', 'doc-1', 'pat-1', 'clinic-1');`);

    expect(() => runSql(`INSERT INTO "ConsultationNote" (id, "updatedAt", "clinicId", "patientId", "appointmentId", "authorId", "authorName") VALUES ('n-3', now(), 'clinic-2', 'pat-1', 'ap-2', 'doc-1', 'Dr. Uno');`)).toThrow(/foreign key|violates/i);
  }, 60000);

  it('refuses to delete an appointment, a patient or a note that has addenda', async () => {
    expect(() => runSql(`DELETE FROM "Appointment" WHERE id = 'ap-1';`)).toThrow(/foreign key|violates/i);
    expect(() => runSql(`DELETE FROM "Patient" WHERE id = 'pat-1';`)).toThrow(/foreign key|violates/i);
    expect(() => runSql(`DELETE FROM "ConsultationNote" WHERE id = 'n-1';`)).toThrow(/foreign key|violates/i);
    expect(await q(`SELECT count(*)::int AS n FROM "ConsultationNote"`)).toEqual([{ n: 1 }]);
  }, 60000);
});
