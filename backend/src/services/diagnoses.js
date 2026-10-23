// The ICD-10 (CIE-10) catalogue and the diagnoses of a consultation note (S10-05).
//
// MedCita ships no copy of the classification: the catalogue table starts empty and is filled
// with `npm run diagnoses:import <file>` (scripts/importDiagnoses.js). This file has what both
// that script and the routes need: how a code is written, how a catalogue file is read and how
// the catalogue is searched.

const SOURCE_DEFAULT = 'msp-rdacaa';
const VERSION_DEFAULT = 'CIE10';
const MAX_NAME_LENGTH = 300;

// Lowercase and without accents ("Cólera" -> "colera"): how names are stored for searching and
// how what the doctor types is read, so "colera" finds "CÓLERA" and "COLERA".
const normalize = (text) =>
  String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// 'a00.0', 'A000' and ' A00 0 ' are the same code: letters upper, digits after.
const codeKeyOf = (text) => String(text ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase();

// The code as doctors write it: the point after the third character.
const formatCode = (text) => {
  const key = codeKeyOf(text);
  return key.length > 3 ? `${key.slice(0, 3)}.${key.slice(3)}` : key;
};

// A valid ICD-10 code: a letter, two digits and up to two more characters (A00, A00.0, S06.01).
const CODE_REGEX = /^[A-Z]\d{2}[0-9A-Z]{0,2}$/;
const isCode = (text) => CODE_REGEX.test(codeKeyOf(text));

// Rows of a catalogue file -> [{ code, name }]. Two formats:
//  - SQL `INSERT INTO CIE (..., CODIGO, NOMBRE, ...) VALUES (...)` statements, as the Ministerio de
//    Salud Pública publishes them in its RDACAA repository (scripts/SCRIPTS_SQLITE/CIE.sql);
//  - CSV/TSV with one code and one name per line (`A00.0;Cólera...`), the shape WHO distributes.
function parseCatalog(text) {
  const source = String(text).replace(/^﻿/, '');
  const rows = [];

  if (/INSERT\s+INTO\s+CIE\b/i.test(source)) {
    // (ID, CIE_ID, 'CIE10', 'A00', 'COLERA', ...): the third text literal is the code, the fourth the name
    const insert = /VALUES\s*\(\s*\d+\s*,\s*(?:NULL|\d+)\s*,\s*'[^']*'\s*,\s*'([^']*)'\s*,\s*'((?:[^']|'')*)'/gi;
    for (const match of source.matchAll(insert)) rows.push({ code: match[1], name: match[2].replace(/''/g, "'") });
  } else {
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cells = line.split(/[;\t,]/).map((cell) => cell.trim().replace(/^"|"$/g, ''));
      if (cells.length >= 2) rows.push({ code: cells[0], name: cells.slice(1).join(', ') });
    }
  }

  // What is not a code is a header line or noise; a code with no name is of no use
  return rows
    .filter((row) => isCode(row.code) && row.name.trim())
    .map((row) => ({ code: formatCode(row.code), name: row.name.trim() }));
}

// The rows ready for the table, from the parsed file. A code that appears twice keeps its first
// name. `selectable` is false for a code that other codes extend (A00 has A00.0, A00.1...: it is
// a heading, not a diagnosis).
function buildCatalog(rows, { source = SOURCE_DEFAULT, version = VERSION_DEFAULT } = {}) {
  const unique = new Map();
  for (const row of rows) if (!unique.has(row.code)) unique.set(row.code, row);

  const keys = [...unique.values()].map((row) => codeKeyOf(row.code));
  const parents = new Set();
  for (const key of keys) for (let length = 3; length < key.length; length += 1) parents.add(key.slice(0, length));

  return [...unique.values()].map((row) => {
    const codeKey = codeKeyOf(row.code);
    return {
      code: row.code,
      codeKey,
      name: row.name,
      searchText: normalize(row.name),
      level: codeKey.length === 3 ? 'category' : 'subcategory',
      selectable: !parents.has(codeKey),
      source,
      version
    };
  });
}

// What the doctor typed, as a `where` of the catalogue: something that looks like a code (a
// letter, then digits: "a00", "E11.9") matches the start of the code; anything else matches when
// every word is in the name. Headings (codes that are split further) are left out.
function searchWhere(query) {
  const text = normalize(query);
  const compact = text.replace(/[\s.]/g, '');
  const base = { selectable: true };
  if (/^[a-z]\d[0-9a-z]*$/.test(compact)) return { ...base, codeKey: { startsWith: compact.toUpperCase() } };
  const words = text.split(/\s+/).filter(Boolean);
  return { ...base, AND: words.map((word) => ({ searchText: { contains: word } })) };
}

async function search(db, query, limit = 20) {
  const rows = await db.diagnosisCode.findMany({
    where: searchWhere(query),
    // exact and shorter codes first, then alphabetical
    orderBy: [{ codeKey: 'asc' }],
    take: limit,
    select: { code: true, name: true, level: true }
  });
  return rows;
}

module.exports = {
  SOURCE_DEFAULT,
  VERSION_DEFAULT,
  MAX_NAME_LENGTH,
  normalize,
  codeKeyOf,
  formatCode,
  isCode,
  parseCatalog,
  buildCatalog,
  searchWhere,
  search
};
