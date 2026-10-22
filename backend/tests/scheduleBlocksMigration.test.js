const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../src/config/prisma');
const { getTestDatabaseUrl } = require('./testDatabase');

// The schedule blocks migration runs on production (Neon) over a database that already has
// clinics, doctors and appointments, which an empty test database never exercises. This builds
// the schema as it was before it, fills it with rows like production's, applies the migration
// and looks at the result. It works in a schema of its own inside the test database.
const SCHEMA = 'schedule_blocks_migration_test';
const MIGRATION = '20261024100000_add_schedule_blocks';

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

// Production today: two clinics with doctors, patients and appointments (some with a type already)
const LEGACY_ROWS = `
  INSERT INTO "Clinic" (id, name, slug) VALUES ('clinic-1', 'Consultorio Uno', 'uno'), ('clinic-2', 'Consultorio Dos', 'dos');
  INSERT INTO "Doctor" (id, name, email, password, role, "clinicId") VALUES
    ('doc-1', 'Dr. Uno', 'uno@x.test', 'hash', 'doctor', 'clinic-1'),
    ('doc-2', 'Dra. Dos', 'dos@x.test', 'hash', 'doctor', 'clinic-2');
  INSERT INTO "Patient" (id, name, phone, "clinicId") VALUES ('pat-1', 'Paciente 1', '+593900000001', 'clinic-1');
  INSERT INTO "AppointmentType" (id, name, "durationMinutes", color, "isDefault", "clinicId") VALUES ('type-1', 'Consultation', 30, '#0ea5e9', true, 'clinic-1');
  INSERT INTO "Appointment" (id, date, time, status, "doctorId", "patientId", "clinicId", "typeId") VALUES
    ('ap-1', '2030-01-14', '09:00', 'confirmed', 'doc-1', 'pat-1', 'clinic-1', 'type-1');
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

describe('schedule blocks migration on a database that already has data', () => {
  it('only adds an empty table: every existing row is as it was', async () => {
    expect(await q('SELECT count(*)::int AS n FROM "ScheduleBlock"')).toEqual([{ n: 0 }]);
    expect(await q('SELECT count(*)::int AS n FROM "Clinic"')).toEqual([{ n: 2 }]);
    expect(await q('SELECT count(*)::int AS n FROM "Doctor"')).toEqual([{ n: 2 }]);
    expect(await q(`SELECT id, date, time, status, "typeId", "durationMinutes" FROM "Appointment"`)).toEqual([
      { id: 'ap-1', date: '2030-01-14', time: '09:00', status: 'confirmed', typeId: 'type-1', durationMinutes: 30 }
    ]);
  }, 60000);

  it('takes a block for one doctor and one for the whole clinic', async () => {
    runSql(`
      INSERT INTO "ScheduleBlock" (id, "startDate", "endDate", reason, "clinicId", "doctorId") VALUES
        ('b-doc', '2030-02-04', '2030-02-08', 'Vacaciones', 'clinic-1', 'doc-1'),
        ('b-clinic', '2030-02-12', '2030-02-12', 'Feriado', 'clinic-1', NULL);
    `);

    expect(await q(`SELECT id, "doctorId" FROM "ScheduleBlock" ORDER BY id`)).toEqual([
      { id: 'b-clinic', doctorId: null },
      { id: 'b-doc', doctorId: 'doc-1' }
    ]);
  }, 60000);

  it('refuses a block for a doctor of another clinic, and one for a clinic that does not exist', async () => {
    expect(() =>
      runSql(`INSERT INTO "ScheduleBlock" (id, "startDate", "endDate", reason, "clinicId", "doctorId") VALUES ('b-x', '2030-02-04', '2030-02-04', 'Ajeno', 'clinic-2', 'doc-1');`)
    ).toThrow(/foreign key|violates/i);
    expect(() =>
      runSql(`INSERT INTO "ScheduleBlock" (id, "startDate", "endDate", reason, "clinicId") VALUES ('b-y', '2030-02-04', '2030-02-04', 'Sin consultorio', 'nope');`)
    ).toThrow(/foreign key|violates/i);
  }, 60000);

  it('goes away with its doctor, and the clinic-wide ones stay', async () => {
    runSql(`DELETE FROM "Doctor" WHERE id = 'doc-2'; INSERT INTO "Doctor" (id, name, email, password, role, "clinicId") VALUES ('doc-3', 'Dr. Tres', 'tres@x.test', 'hash', 'doctor', 'clinic-2');
            INSERT INTO "ScheduleBlock" (id, "startDate", "endDate", reason, "clinicId", "doctorId") VALUES ('b-3', '2030-03-01', '2030-03-01', 'Congreso', 'clinic-2', 'doc-3');
            DELETE FROM "Doctor" WHERE id = 'doc-3';`);

    expect(await q(`SELECT count(*)::int AS n FROM "ScheduleBlock" WHERE id = 'b-3'`)).toEqual([{ n: 0 }]);
    expect(await q(`SELECT count(*)::int AS n FROM "ScheduleBlock" WHERE id = 'b-clinic'`)).toEqual([{ n: 1 }]);
  }, 60000);
});
