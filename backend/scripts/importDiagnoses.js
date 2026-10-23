// Loads the ICD-10 (CIE-10) catalogue: `npm run diagnoses:import -- <file>` (S10-05).
//
// MedCita does not ship the classification, so until this has run the diagnosis search finds
// nothing (the doctor can still type a diagnosis as free text). The file is one of:
//   - the Ministerio de Salud Pública's `CIE.sql` (INSERT statements), or
//   - a CSV/TSV with a code and a name per line (the shape WHO distributes).
// Where it comes from and the licence caveats are in docs/TECHNICAL.md ("Diagnósticos CIE-10").
//
// It replaces the rows of the same --source, in one transaction, and touches nothing else: the
// diagnoses already written in notes keep their own copy of the code and the name. A database
// that is not local is only loaded when the host is named:
//
//   DIAGNOSES_IMPORT_HOST=<host of DATABASE_URL> npm run diagnoses:import -- <file>
require('dotenv').config();
const fs = require('fs');
const { parseCatalog, buildCatalog, SOURCE_DEFAULT, VERSION_DEFAULT } = require('../src/services/diagnoses');

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const CHUNK = 1000;

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

function parseArgs(argv) {
  const options = { source: SOURCE_DEFAULT, version: VERSION_DEFAULT, file: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') options.source = argv[(i += 1)];
    else if (argv[i] === '--version') options.version = argv[(i += 1)];
    else if (!argv[i].startsWith('--')) options.file = argv[i];
  }
  return options;
}

async function main(argv = process.argv.slice(2), env = process.env, out = console.log) {
  const { file, source, version } = parseArgs(argv);
  if (!file) {
    out('Usage: npm run diagnoses:import -- <file> [--source msp-rdacaa] [--version CIE10]');
    return 1;
  }
  if (!fs.existsSync(file)) {
    out(`The file ${file} does not exist.`);
    return 1;
  }

  const host = hostOf(env.DATABASE_URL);
  if (!host) {
    out('DATABASE_URL is missing or is not a URL.');
    return 1;
  }
  if (!LOCAL_HOSTS.includes(host) && env.DIAGNOSES_IMPORT_HOST !== host) {
    out(`DATABASE_URL points to ${host}, which is not a local database, so nothing was loaded.`);
    out(`If that is the database to load, run it again with DIAGNOSES_IMPORT_HOST=${host}`);
    return 1;
  }

  const rows = buildCatalog(parseCatalog(fs.readFileSync(file, 'utf8')), { source, version });
  if (rows.length === 0) {
    out('The file has no codes in a format this command understands. Nothing was loaded.');
    return 1;
  }

  const prisma = require('../src/config/prisma');
  try {
    await prisma.$transaction(async (tx) => {
      await tx.diagnosisCode.deleteMany({ where: { source } });
      for (let i = 0; i < rows.length; i += CHUNK) {
        await tx.diagnosisCode.createMany({ data: rows.slice(i, i + CHUNK) });
      }
    }, { timeout: 120000 });
    const selectable = rows.filter((row) => row.selectable).length;
    out(`Loaded ${rows.length} codes (${selectable} selectable) as source "${source}", ${version}, into ${host}.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
