const { ADULT_AGE } = require('./patientRecord');

// What the patient list accepts besides ?page and ?pageSize (S10.5-07). Everything is checked
// against a fixed list and a bad value is a 400 (it is never ignored), so a typo in a screen
// does not look like "no filter".

const CONSENT_FILTERS = ['none', 'granted', 'outdated', 'withdrawn'];
const MINOR_FILTERS = ['true', 'false'];
const ORDERS = ['asc', 'desc'];
// The columns the list can be ordered by. Only ones that live in the patient row: ordering by the
// latest consent or by the number of appointments would need a join and a count over every
// patient of the clinic on each page. `age` is the birth date in reverse (the oldest first is the
// smallest birth date).
const SORTS = ['name', 'cedula', 'phone', 'age', 'createdAt'];
const DEFAULT_SORT = 'createdAt';
const MAX_SEARCH_LENGTH = 100;

const single = (value) => (Array.isArray(value) ? undefined : value);

// The list parameters of a request. -> { error } or { search, consent, minor, sort, order }
function parseListQuery(query) {
  const { search, consent, minor, sort, order } = query;

  for (const [name, value] of Object.entries({ search, consent, minor, sort, order })) {
    if (value !== undefined && typeof single(value) !== 'string') return { error: `${name} must be a single value` };
  }
  if (consent !== undefined && !CONSENT_FILTERS.includes(consent)) {
    return { error: `consent must be one of: ${CONSENT_FILTERS.join(', ')}` };
  }
  if (minor !== undefined && !MINOR_FILTERS.includes(minor)) return { error: 'minor must be true or false' };
  if (sort !== undefined && !SORTS.includes(sort)) return { error: `sort must be one of: ${SORTS.join(', ')}` };
  if (order !== undefined && !ORDERS.includes(order)) return { error: 'order must be asc or desc' };

  const text = typeof search === 'string' ? search.trim().slice(0, MAX_SEARCH_LENGTH) : '';
  const column = sort || DEFAULT_SORT;
  return {
    search: text || null,
    consent: consent || null,
    minor: minor === undefined ? null : minor === 'true',
    sort: column,
    // The newest first by default; a name, an ID card... from the start
    order: order || (column === DEFAULT_SORT ? 'desc' : 'asc')
  };
}

// The birth date that turns 18 today: whoever was born after it is a minor, whoever was born on it
// or before is an adult (the same rule as `isMinor`, written as a comparison of dates, which are
// 'YYYY-MM-DD' text). `today` is the clinic's date.
function minorCutoff(today) {
  const [year, month, day] = today.split('-');
  return `${String(Number(year) - ADULT_AGE).padStart(4, '0')}-${month}-${day}`;
}

// The `where` of the list: the search, the minor filter and the consent filter all have to hold.
// `consentIds` is { ids, negate } from patientConsent.standingFilter (the consent depends on the
// latest event of each patient, so it is worked out apart); null without a consent filter.
function buildWhere({ search, minor }, { today, consentIds = null }) {
  const all = [];
  if (search) {
    all.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { cedula: { contains: search } }
      ]
    });
  }
  if (minor !== null) {
    const cutoff = minorCutoff(today);
    all.push(minor ? { birthDate: { gt: cutoff } } : { OR: [{ birthDate: null }, { birthDate: { lte: cutoff } }] });
  }
  if (consentIds) all.push({ id: consentIds.negate ? { notIn: consentIds.ids } : { in: consentIds.ids } });
  return all.length ? { AND: all } : {};
}

// The order of the list (the names are ordered by sortByName, not by the database). The id is always the last key: without a unique last key two patients
// with the same name (or the same createdAt) can swap places between two requests and a page
// would repeat or skip a row. A column that can be empty puts the empty ones last in both directions.
function buildOrderBy({ sort, order }) {
  const nulls = (field) => ({ [field]: { sort: order, nulls: 'last' } });
  switch (sort) {
    case 'name':
      return [{ name: order }, { id: 'asc' }];
    case 'cedula':
    case 'phone':
      return [sort === 'phone' ? { phone: order } : nulls('cedula'), { name: 'asc' }, { id: 'asc' }];
    case 'age':
      return [{ birthDate: { sort: order === 'asc' ? 'desc' : 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }];
    default:
      return [{ createdAt: order }, { id: 'asc' }];
  }
}

// Names are ordered here and not by the database: PostgreSQL orders text by the collation the database
// was created with, and that is not the same everywhere (on the local Docker database it is byte order:
// "zoe" after "Zoe", "María" after "Marta"). The Spanish collator ignores case and accents the way a
// person reading a directory expects. `rows` are { id, name }; the id breaks ties so the order is total.
const NAME_COLLATOR = new Intl.Collator('es', { sensitivity: 'base' });
function sortByName(rows, order) {
  const direction = order === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => direction * NAME_COLLATOR.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

module.exports = { sortByName, CONSENT_FILTERS, SORTS, ORDERS, DEFAULT_SORT, parseListQuery, buildWhere, buildOrderBy, minorCutoff };
