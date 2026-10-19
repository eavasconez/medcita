// The suite truncates every table between tests, so it must NEVER be pointed at
// a real database. It only ever uses TEST_DATABASE_URL (never DATABASE_URL) and
// refuses to run unless the database name ends in "_test".
function getTestDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a dedicated test database, e.g.\n' +
        '  TEST_DATABASE_URL="postgresql://postgres:password123@localhost:5432/medcita_test?schema=public"\n' +
        'See docs/TECHNICAL.md ("Pruebas automatizadas").'
    );
  }

  let dbName;
  try {
    dbName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid connection string.');
  }

  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run the tests against database "${dbName}": the test database name must end with "_test" ` +
        'because the suite wipes all its tables.'
    );
  }
  return url;
}

// The Postgres schema the test tables live in ("?schema=public" in the URL).
function getTestSchemaName(url = getTestDatabaseUrl()) {
  const schema = new URL(url).searchParams.get('schema') || 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`TEST_DATABASE_URL has an unsupported schema name: "${schema}".`);
  }
  return schema;
}

module.exports = { getTestDatabaseUrl, getTestSchemaName };
