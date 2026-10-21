const request = require('supertest');
const app = require('../src/server');
const { prisma } = require('./helpers/db');
const {
  OK_TTL_MS,
  FAILED_TTL_MS,
  expectedSchema,
  findMissing,
  getSchemaStatus,
  logSchemaStatus,
  resetSchemaStatus
} = require('../src/services/schemaCheck');

beforeEach(resetSchemaStatus);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

// Tests that break the schema on purpose put it back before they finish. The
// suite runs one file at a time and rebuilds the test schema before starting.
async function withBrokenSchema(breakSql, fixSql, run) {
  await prisma.$executeRawUnsafe(breakSql);
  try {
    await run();
  } finally {
    await prisma.$executeRawUnsafe(fixSql);
  }
}
const DROP_COLUMN = 'ALTER TABLE "Doctor" DROP COLUMN "passwordChangedAt"';
const ADD_COLUMN = 'ALTER TABLE "Doctor" ADD COLUMN "passwordChangedAt" TIMESTAMP(3)';
const HIDE_TABLE = 'ALTER TABLE "PasswordResetToken" RENAME TO "PasswordResetToken_hidden"';
const SHOW_TABLE = 'ALTER TABLE "PasswordResetToken_hidden" RENAME TO "PasswordResetToken"';

describe('expectedSchema', () => {
  it('lists the columns of every model of schema.prisma, without relations', () => {
    const expected = expectedSchema();

    expect(Object.keys(expected).sort()).toEqual(['Appointment', 'AuditLog', 'Availability', 'Clinic', 'Doctor', 'Patient', 'PasswordResetToken', 'SignupRequest', 'Invitation', 'NotificationLog', 'PatientConsent'].sort());
    expect(expected.AuditLog).toEqual(expect.arrayContaining(['actorId', 'action', 'entity', 'entityId', 'changes']));
    expect(expected.Doctor).toEqual(expect.arrayContaining(['id', 'email', 'password', 'passwordChangedAt']));
    expect(expected.Appointment).toEqual(expect.arrayContaining(['reminderSentAt', 'doctorId', 'patientId']));
    expect(expected.Doctor).not.toContain('appointments');
    expect(expected.Appointment).not.toContain('patient');
  });
});

describe('findMissing', () => {
  const expected = { Doctor: ['id', 'email'], Patient: ['id'] };
  const row = (table_name, column_name) => ({ table_name, column_name });

  it('finds nothing when every table and column is there, ignoring extras', () => {
    const rows = [row('Doctor', 'id'), row('Doctor', 'email'), row('Doctor', 'legacy'), row('Patient', 'id'), row('Other', 'x')];

    expect(findMissing(expected, rows)).toEqual([]);
  });

  it('names each missing column as Table.column', () => {
    expect(findMissing(expected, [row('Doctor', 'id'), row('Patient', 'id')])).toEqual(['Doctor.email']);
  });

  it('names a table that does not exist once, not column by column', () => {
    expect(findMissing(expected, [row('Doctor', 'id'), row('Doctor', 'email')])).toEqual(['Patient']);
    expect(findMissing(expected, [])).toEqual(['Doctor', 'Patient']);
  });
});

describe('against the real database', () => {
  it('finds nothing missing in a database built from the migrations', async () => {
    expect(await getSchemaStatus()).toMatchObject({ ok: true, missing: [] });
  });

  it('reports a column that was never added (the S7-08 incident)', async () => {
    await withBrokenSchema(DROP_COLUMN, ADD_COLUMN, async () => {
      const status = await getSchemaStatus();

      expect(status).toMatchObject({ ok: false, reason: 'schema_outdated', missing: ['Doctor.passwordChangedAt'] });
    });
  });

  it('reports a table that was never created', async () => {
    await withBrokenSchema(HIDE_TABLE, SHOW_TABLE, async () => {
      const status = await getSchemaStatus();

      expect(status).toMatchObject({ ok: false, reason: 'schema_outdated', missing: ['PasswordResetToken'] });
    });
  });

  it('reports an unreachable database instead of throwing', async () => {
    jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(await getSchemaStatus()).toMatchObject({ ok: false, reason: 'database_unreachable', missing: [] });
  });
});

describe('how long an answer is remembered', () => {
  const queries = () => jest.spyOn(prisma, '$queryRaw');

  it('does not ask the database again while a healthy answer is fresh, so pings cannot keep it awake', async () => {
    const spy = queries();
    await getSchemaStatus();
    await getSchemaStatus();
    await getSchemaStatus();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('asks again once a healthy answer is older than an hour', async () => {
    const spy = queries();
    await getSchemaStatus();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + OK_TTL_MS + 1);

    await getSchemaStatus();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('asks again soon after a bad answer, and recovers without a restart once the schema is fixed', async () => {
    await withBrokenSchema(DROP_COLUMN, ADD_COLUMN, async () => {
      expect((await getSchemaStatus()).ok).toBe(false);
    });
    expect((await getSchemaStatus()).ok).toBe(false); // still the remembered bad answer
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + FAILED_TTL_MS + 1);

    expect((await getSchemaStatus()).ok).toBe(true);
  });

  it('answers simultaneous callers with a single query', async () => {
    const spy = queries();

    const answers = await Promise.all([getSchemaStatus(), getSchemaStatus(), getSchemaStatus()]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(answers.every((a) => a.ok)).toBe(true);
  });

  it('skips the remembered answer when forced', async () => {
    const spy = queries();
    await getSchemaStatus();
    await getSchemaStatus({ force: true });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/health', () => {
  it('answers 200 { status: "ok" } when the database matches the code', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers 503 when the database is behind the code, without saying what is missing', async () => {
    await withBrokenSchema(DROP_COLUMN, ADD_COLUMN, async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'error', reason: 'schema_outdated' });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordChangedAt|Doctor/);
    });
  });

  it('answers 503 when the database cannot be reached', async () => {
    jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', reason: 'database_unreachable' });
  });

  it('goes back to 200 on its own after the schema is fixed', async () => {
    await withBrokenSchema(DROP_COLUMN, ADD_COLUMN, async () => {
      expect((await request(app).get('/api/health')).status).toBe(503);
    });
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + FAILED_TTL_MS + 1);

    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});

describe('logSchemaStatus', () => {
  it('says what is missing and how to fix it when the schema is out of date', () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    logSchemaStatus({ ok: false, reason: 'schema_outdated', missing: ['Doctor.passwordChangedAt', 'PasswordResetToken'] });

    const message = logged.mock.calls[0][0];
    expect(message).toMatch(/OUT OF DATE/);
    expect(message).toContain('Doctor.passwordChangedAt, PasswordResetToken');
    expect(message).toContain('npx prisma migrate deploy');
  });

  it('only logs a normal line when everything matches', () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    logSchemaStatus({ ok: true, missing: [] });

    expect(logged).not.toHaveBeenCalled();
  });
});
