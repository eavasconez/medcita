const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');

// The code is only as good as the database it runs against. The Prisma client
// is generated from schema.prisma, so it expects exactly those tables and
// columns; when the database is behind (a migration nobody applied) every query
// that touches the missing piece fails, and the app tends to hide it as "no
// data". This compares what the client expects with what the database really
// has, so that state can be reported loudly instead.
//
// It looks at the tables and columns themselves, not at the migration history:
// a database that came from `db push` has no history but may be perfectly fine,
// and one with a registered history can still be missing a column.

// A healthy answer is remembered for a long time: it can only change with a
// deploy (which restarts the process and checks again), and re-asking on every
// ping would keep a serverless database (Neon) awake around the clock. A bad
// answer is re-checked soon, so the service recovers as soon as it is fixed.
const OK_TTL_MS = 60 * 60 * 1000;
const FAILED_TTL_MS = 10 * 1000;

const REASON = { schemaOutdated: 'schema_outdated', databaseUnreachable: 'database_unreachable' };

// { tableName: [columnName, ...] } for every model of schema.prisma. Relation
// fields are not columns.
function expectedSchema() {
  const expected = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    expected[model.dbName || model.name] = model.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => field.dbName || field.name);
  }
  return expected;
}

// What is missing, given the rows of information_schema.columns
// ({ table_name, column_name }). A table that does not exist at all is reported
// once, by name; otherwise each absent column as "Table.column".
function findMissing(expected, rows) {
  const present = new Map();
  for (const { table_name: table, column_name: column } of rows) {
    if (!present.has(table)) present.set(table, new Set());
    present.get(table).add(column);
  }

  const missing = [];
  for (const [table, columns] of Object.entries(expected)) {
    const existing = present.get(table);
    if (!existing) {
      missing.push(table);
      continue;
    }
    for (const column of columns) {
      if (!existing.has(column)) missing.push(`${table}.${column}`);
    }
  }
  return missing;
}

async function findMissingInDatabase() {
  const rows = await prisma.$queryRaw`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()
  `;
  return findMissing(expectedSchema(), rows);
}

let cached = null; // { ok, reason?, missing, checkedAt }
let inFlight = null;

const isFresh = (entry) =>
  entry && Date.now() - entry.checkedAt < (entry.ok ? OK_TTL_MS : FAILED_TTL_MS);

/**
 * { ok: true } when the database has everything the code needs; otherwise
 * { ok: false, reason, missing } with reason `schema_outdated` or
 * `database_unreachable`. Never throws. `force` skips the remembered answer.
 */
async function getSchemaStatus({ force = false } = {}) {
  if (!force && isFresh(cached)) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const missing = await findMissingInDatabase();
      cached = missing.length === 0
        ? { ok: true, missing: [], checkedAt: Date.now() }
        : { ok: false, reason: REASON.schemaOutdated, missing, checkedAt: Date.now() };
    } catch (err) {
      console.error('Schema check could not reach the database:', err.message);
      cached = { ok: false, reason: REASON.databaseUnreachable, missing: [], checkedAt: Date.now() };
    }
    return cached;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

// The details stay in the server log: /api/health is public, and the names of
// missing columns are nobody else's business.
function logSchemaStatus(status) {
  if (status.ok) {
    console.log('Database schema matches the code.');
  } else if (status.reason === REASON.schemaOutdated) {
    console.error(
      `DATABASE SCHEMA IS OUT OF DATE: missing ${status.missing.join(', ')}. ` +
        'Requests that touch them will fail. Apply the pending migrations with `npx prisma migrate deploy` ' +
        '(see docs/DEPLOY.md, "Contrato de despliegue del backend"). /api/health answers 503 until then.'
    );
  } else {
    console.error('Could not check the database schema: the database is unreachable. /api/health answers 503 until it is.');
  }
}

// For tests: forget the remembered answer.
function resetSchemaStatus() {
  cached = null;
  inFlight = null;
}

module.exports = {
  OK_TTL_MS,
  FAILED_TTL_MS,
  REASON,
  expectedSchema,
  findMissing,
  getSchemaStatus,
  logSchemaStatus,
  resetSchemaStatus
};
