const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

// The two migrations that put every record into a clinic run on production (Neon)
// over data that already exists, which is exactly what an empty test database never
// exercises. This builds the schema as it was before them, fills it with rows like
// the ones production has, applies them and looks at the result. It works in a
// schema of its own inside the test database, so the rest of the suite is untouched.
const SCHEMA = 'clinic_migration_test';
const DEFAULT_CLINIC_ID = '00000000-0000-4000-8000-000000000001';
const STEP_1 = '20261021120000_add_clinics';
const STEP_2 = '20261021120100_require_clinic_id';

const backendDir = path.join(__dirname, '..');
const migrationsDir = path.join(backendDir, 'prisma', 'migrations');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const migrationSql = (name) => fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
const migrationsBefore = () =>
  fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < STEP_1)
    .map((entry) => entry.name)
    .sort();

function urlForSchema(schema) {
  const url = new URL(getTestDatabaseUrl());
  url.searchParams.set('schema', schema);
  return url.toString();
}

// Runs a SQL script (several statements) inside the scratch schema
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

// An empty schema with the structure the database had before the clinics existed
function createLegacySchema() {
  runSql(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE; CREATE SCHEMA "${SCHEMA}";`, { schema: 'public' });
  runSql(migrationsBefore().map(migrationSql).join('\n'));
}

// Reads from the scratch schema (the transaction keeps both statements on one connection)
const q = async (sql) => {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL search_path TO "${SCHEMA}"`),
    prisma.$queryRawUnsafe(sql)
  ]);
  return rows;
};

// Rows as production has them today: no clinic anywhere
const LEGACY_ROWS = `
  INSERT INTO "Doctor" (id, name, email, password, role) VALUES
    ('doc-1', 'Dr. Uno', 'uno@x.test', 'hash', 'doctor'),
    ('adm-1', 'Admin', 'admin@x.test', 'hash', 'admin');
  INSERT INTO "Patient" (id, name, phone, cedula) VALUES
    ('pat-1', 'Paciente 1', '+593900000001', '1700000001'),
    ('pat-2', 'Paciente 2', '+593900000002', NULL);
  INSERT INTO "Availability" (id, "dayOfWeek", "startTime", "endTime", "doctorId") VALUES ('av-1', 1, '08:00', '12:00', 'doc-1');
  INSERT INTO "Appointment" (id, date, time, status, "doctorId", "patientId") VALUES ('ap-1', '2030-01-14', '09:00', 'confirmed', 'doc-1', 'pat-1');
  INSERT INTO "AuditLog" (id, "actorId", "actorName", "actorRole", action, entity, "entityId") VALUES ('au-1', 'adm-1', 'Admin', 'admin', 'create', 'patient', 'pat-1');
`;

const TABLES = ['Doctor', 'Patient', 'Availability', 'Appointment', 'AuditLog'];

const withoutClinic = async () => {
  const counts = {};
  for (const table of TABLES) {
    const [row] = await q(`SELECT count(*)::int AS n FROM "${table}" WHERE "clinicId" IS NULL`);
    counts[table] = row.n;
  }
  return counts;
};

const nullable = async (table) => {
  const [row] = await prisma.$queryRawUnsafe(
    `SELECT is_nullable FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${table}' AND column_name = 'clinicId'`
  );
  return row.is_nullable === 'YES';
};

afterAll(async () => {
  runSql(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE;`, { schema: 'public' });
  await prisma.$disconnect();
});

describe('clinic migrations on a database that already has data', () => {
  beforeEach(createLegacySchema, 60000);

  it('step 1 puts every existing record in one default clinic and constrains nothing yet', async () => {
    runSql(LEGACY_ROWS);
    runSql(migrationSql(STEP_1));

    expect(await q('SELECT id, name, slug, timezone FROM "Clinic"')).toEqual([
      { id: DEFAULT_CLINIC_ID, name: 'Consultorio principal', slug: 'principal', timezone: 'America/Guayaquil' }
    ]);
    expect(await withoutClinic()).toEqual({ Doctor: 0, Patient: 0, Availability: 0, Appointment: 0, AuditLog: 0 });
    for (const table of TABLES) expect(await nullable(table)).toBe(true);
  }, 60000);

  it('step 2 then requires a clinic everywhere, and keeps every row and link', async () => {
    runSql(LEGACY_ROWS);
    runSql(migrationSql(STEP_1));
    runSql(migrationSql(STEP_2));

    for (const table of TABLES) expect(await nullable(table)).toBe(false);
    for (const [table, rows] of Object.entries({ Doctor: 2, Patient: 2, Availability: 1, Appointment: 1, AuditLog: 1 })) {
      const [row] = await q(`SELECT count(*)::int AS n FROM "${table}" WHERE "clinicId" = '${DEFAULT_CLINIC_ID}'`);
      expect(row.n).toBe(rows);
    }
    const [appointment] = await q(`SELECT "doctorId", "patientId", "clinicId" FROM "Appointment"`);
    expect(appointment).toEqual({ doctorId: 'doc-1', patientId: 'pat-1', clinicId: DEFAULT_CLINIC_ID });
  }, 60000);

  it('step 2 puts rows written between the two steps (by an older version of the app) in the default clinic', async () => {
    runSql(LEGACY_ROWS);
    runSql(migrationSql(STEP_1));
    // an app that does not know about clinics keeps writing after step 1
    runSql(`
      INSERT INTO "Patient" (id, name, phone) VALUES ('pat-late', 'Llegó tarde', '+593900000077');
      INSERT INTO "Doctor" (id, name, email, password, role) VALUES ('doc-late', 'Dra. Tarde', 'tarde@x.test', 'hash', 'doctor');
    `);
    runSql(migrationSql(STEP_2));

    const late = await q(`SELECT id, "clinicId" FROM "Patient" WHERE id = 'pat-late' UNION ALL SELECT id, "clinicId" FROM "Doctor" WHERE id = 'doc-late'`);
    expect(late).toEqual([
      { id: 'pat-late', clinicId: DEFAULT_CLINIC_ID },
      { id: 'doc-late', clinicId: DEFAULT_CLINIC_ID }
    ]);
  }, 60000);

  it('after step 2 the same phone can belong to patients of two clinics, but not twice to one', async () => {
    runSql(LEGACY_ROWS);
    runSql(migrationSql(STEP_1));
    runSql(migrationSql(STEP_2));

    runSql(`
      INSERT INTO "Clinic" (id, name, slug) VALUES ('clinic-2', 'Otro', 'otro');
      INSERT INTO "Patient" (id, name, phone, "clinicId") VALUES ('pat-other', 'Mismo teléfono', '+593900000001', 'clinic-2');
    `);
    expect((await q(`SELECT count(*)::int AS n FROM "Patient" WHERE phone = '+593900000001'`))[0].n).toBe(2);

    expect(() =>
      runSql(`INSERT INTO "Patient" (id, name, phone, "clinicId") VALUES ('pat-dup', 'Repetido', '+593900000001', 'clinic-2');`)
    ).toThrow(/duplicate key|unique/i);
  }, 60000);
});

describe('clinic migrations on a brand-new database', () => {
  it('create no clinic: each one is created when it signs up', async () => {
    createLegacySchema();
    runSql(migrationSql(STEP_1));
    runSql(migrationSql(STEP_2));

    expect(await q('SELECT count(*)::int AS n FROM "Clinic"')).toEqual([{ n: 0 }]);
  }, 60000);

  it('create the default clinic on step 2 if an older app wrote the first rows in between', async () => {
    createLegacySchema();
    runSql(migrationSql(STEP_1)); // empty database: no clinic yet
    runSql(`INSERT INTO "Doctor" (id, name, email, password, role) VALUES ('doc-first', 'Primera', 'primera@x.test', 'hash', 'doctor');`);
    runSql(migrationSql(STEP_2));

    expect(await q(`SELECT id FROM "Clinic"`)).toEqual([{ id: DEFAULT_CLINIC_ID }]);
    expect(await q(`SELECT "clinicId" FROM "Doctor" WHERE id = 'doc-first'`)).toEqual([{ clinicId: DEFAULT_CLINIC_ID }]);
  }, 60000);
});
