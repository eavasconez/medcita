const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { CURRENT_CONSENT_VERSION } = require('../src/legal/healthDataConsent');
const { minorCutoff } = require('../src/services/patientList');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const list = (token, query = {}) => request(app).get('/api/patients').query(query).set(bearer(token));
const names = (res) => res.body.patients.map((p) => p.name);

// A consent event of a patient: `granted` and the text it was given to
async function consent(user, patient, { granted = true, documentVersion = CURRENT_CONSENT_VERSION, createdAt } = {}) {
  return prisma.patientConsent.create({
    data: {
      clinicId: user.clinicId, patientId: patient.id, granted, documentVersion, method: 'in_person_signed',
      recordedById: user.id, recordedByName: user.name, recordedByRole: user.role, ...(createdAt && { createdAt })
    }
  });
}

// The birth date of someone who has `years` years and `days` more days than that
const bornAgo = (years, extraDays = 0) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - extraDays);
  return d.toISOString().slice(0, 10);
};

describe('GET /api/patients?consent=', () => {
  async function setup() {
    const { user, token } = await createUser();
    const granted = await createPatient({ name: 'Granted' });
    const outdated = await createPatient({ name: 'Outdated' });
    const withdrawn = await createPatient({ name: 'Withdrawn' });
    const regained = await createPatient({ name: 'Regained' });
    const none = await createPatient({ name: 'None' });
    await consent(user, granted);
    await consent(user, outdated, { documentVersion: '2020-01-v0' });
    await consent(user, withdrawn);
    await consent(user, withdrawn, { granted: false, createdAt: new Date(Date.now() + 1000) });
    // withdrew and then gave it again: the latest event decides
    await consent(user, regained, { granted: false, createdAt: new Date(Date.now() - 5000) });
    await consent(user, regained, { granted: true, createdAt: new Date(Date.now() - 1000) });
    return { token, user, none };
  }

  it.each([
    ['granted', ['Granted', 'Regained']],
    ['outdated', ['Outdated']],
    ['withdrawn', ['Withdrawn']],
    ['none', ['None']]
  ])('%s keeps only the patients standing there (by their latest event)', async (standing, expected) => {
    const { token } = await setup();

    const res = await list(token, { consent: standing, sort: 'name' });

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(expected);
    expect(res.body.total).toBe(expected.length);
    const status = { granted: 'granted', outdated: 'granted', withdrawn: 'withdrawn', none: 'none' }[standing];
    for (const p of res.body.patients) expect(p.consent.status).toBe(status);
  });

  it('counts and pages only what matches', async () => {
    const { token } = await setup();

    const res = await list(token, { consent: 'granted', sort: 'name', pageSize: 1, page: 2 });

    expect(res.body).toMatchObject({ total: 2, page: 2, totalPages: 2 });
    expect(names(res)).toEqual(['Regained']);
  });

  it('does not see the consents of another clinic', async () => {
    const { user, token } = await createUser();
    const mine = await createPatient({ name: 'Mine' });
    const otherClinic = await createClinic();
    const { user: other } = await createUser({ clinic: otherClinic });
    const theirs = await createPatient({ name: 'Theirs', clinic: otherClinic });
    await consent(other, theirs);
    await consent(user, mine, { granted: false });

    const granted = await list(token, { consent: 'granted' });
    const none = await list(token, { consent: 'none' });
    const withdrawn = await list(token, { consent: 'withdrawn' });

    expect(names(granted)).toEqual([]);
    expect(names(none)).toEqual([]);
    expect(names(withdrawn)).toEqual(['Mine']);
  });
});

describe('GET /api/patients?minor=', () => {
  it('separates the minors from the adults by the same rule as the record (18 today = adult)', async () => {
    const { token } = await createUser();
    await createPatient({ name: 'Baby', birthDate: bornAgo(0, 40) });
    await createPatient({ name: 'Almost 18', birthDate: bornAgo(17, 20) });
    await createPatient({ name: 'Turns 18 today', birthDate: bornAgo(18) });
    await createPatient({ name: 'Adult', birthDate: bornAgo(45) });
    await createPatient({ name: 'No birth date' });

    const minors = await list(token, { minor: 'true', sort: 'name' });
    const adults = await list(token, { minor: 'false', sort: 'name' });
    const all = await list(token);

    expect(names(minors)).toEqual(['Almost 18', 'Baby']);
    expect(minors.body.patients.every((p) => p.isMinor)).toBe(true);
    // without a birth date they are not known to be a minor, so they are in the adults
    expect(names(adults)).toEqual(['Adult', 'No birth date', 'Turns 18 today']);
    expect(adults.body.patients.every((p) => !p.isMinor)).toBe(true);
    expect(all.body.total).toBe(5);
  });

  it('agrees with the rule on the day someone turns 18 (cutoff of the clinic\'s date)', () => {
    expect(minorCutoff('2026-10-27')).toBe('2008-10-27');
    expect(minorCutoff('2026-02-28')).toBe('2008-02-28');
    // born on the 29th of February 2008: still 17 on 28 February 2026, so after the cutoff
    expect('2008-02-29' > minorCutoff('2026-02-28')).toBe(true);
  });

  it('combines with the search and the consent filter (all must hold)', async () => {
    const { user, token } = await createUser();
    const a = await createPatient({ name: 'Ana Niña', birthDate: bornAgo(5) });
    const b = await createPatient({ name: 'Ana Adulta', birthDate: bornAgo(40) });
    const c = await createPatient({ name: 'Luis Niño', birthDate: bornAgo(6) });
    await consent(user, a);
    await consent(user, b);

    const res = await list(token, { search: 'ana', minor: 'true', consent: 'granted' });

    expect(names(res)).toEqual(['Ana Niña']);
    expect(c.id).toBeDefined();
  });
});

describe('GET /api/patients?sort=&order=', () => {
  it('orders by name in both directions, and the default is the newest first', async () => {
    const { token } = await createUser();
    await createPatient({ name: 'Beto', createdAt: new Date(2030, 0, 1) });
    await createPatient({ name: 'Ana', createdAt: new Date(2030, 0, 2) });
    await createPatient({ name: 'Carla', createdAt: new Date(2030, 0, 3) });

    expect(names(await list(token))).toEqual(['Carla', 'Ana', 'Beto']);
    expect(names(await list(token, { sort: 'name' }))).toEqual(['Ana', 'Beto', 'Carla']);
    expect(names(await list(token, { sort: 'name', order: 'desc' }))).toEqual(['Carla', 'Beto', 'Ana']);
    expect(names(await list(token, { sort: 'createdAt', order: 'asc' }))).toEqual(['Beto', 'Ana', 'Carla']);
    // an order alone applies to the default column
    expect(names(await list(token, { order: 'asc' }))).toEqual(['Beto', 'Ana', 'Carla']);
  });

  it('orders names the way Spanish does, ignoring case and accents (whatever the database collation)', async () => {
    const { token } = await createUser();
    for (const name of ['zoe', 'Marta', 'María', 'ángela', 'Ana', 'Álvaro', 'Óscar', 'oscar']) await createPatient({ name });

    const asc = names(await list(token, { sort: 'name' }));
    const desc = names(await list(token, { sort: 'name', order: 'desc' }));

    expect(asc.slice(0, 3)).toEqual(['Álvaro', 'Ana', 'ángela']);
    expect(asc.indexOf('María')).toBeLessThan(asc.indexOf('Marta'));
    expect(asc[asc.length - 1]).toBe('zoe');
    expect(new Set(asc.slice(5, 7))).toEqual(new Set(['Óscar', 'oscar']));
    expect(desc.slice(0, 1)).toEqual(['zoe']);
    expect(desc).toEqual([...desc].sort((a, b) => b.localeCompare(a, 'es', { sensitivity: 'base' }) || 0));
  });

  it('pages the name order with the same rule, and only inside the clinic', async () => {
    const { token } = await createUser();
    const other = await createClinic();
    for (const name of ['Delta', 'alfa', 'Charlie', 'Bravo']) await createPatient({ name });
    await createPatient({ name: 'Aaron of another clinic', clinic: other });

    const page1 = await list(token, { sort: 'name', pageSize: 2, page: 1 });
    const page2 = await list(token, { sort: 'name', pageSize: 2, page: 2 });

    expect(names(page1)).toEqual(['alfa', 'Bravo']);
    expect(names(page2)).toEqual(['Charlie', 'Delta']);
    expect(page1.body).toMatchObject({ total: 4, totalPages: 2 });
  });

  it('orders by phone and by cedula, with the patients without a cedula last either way', async () => {
    const { token } = await createUser();
    await createPatient({ name: 'P1', phone: '+593990000003', cedula: '1700000003' });
    await createPatient({ name: 'P2', phone: '+593990000001', cedula: null });
    await createPatient({ name: 'P3', phone: '+593990000002', cedula: '1700000001' });

    expect(names(await list(token, { sort: 'phone' }))).toEqual(['P2', 'P3', 'P1']);
    expect(names(await list(token, { sort: 'cedula' }))).toEqual(['P3', 'P1', 'P2']);
    expect(names(await list(token, { sort: 'cedula', order: 'desc' }))).toEqual(['P1', 'P3', 'P2']);
  });

  it('orders by age: youngest first is asc, and those without a birth date go last', async () => {
    const { token } = await createUser();
    await createPatient({ name: 'Old', birthDate: '1950-05-05' });
    await createPatient({ name: 'Young', birthDate: bornAgo(3) });
    await createPatient({ name: 'Unknown' });
    await createPatient({ name: 'Middle', birthDate: '1990-01-01' });

    expect(names(await list(token, { sort: 'age' }))).toEqual(['Young', 'Middle', 'Old', 'Unknown']);
    expect(names(await list(token, { sort: 'age', order: 'desc' }))).toEqual(['Old', 'Middle', 'Young', 'Unknown']);
  });

  it('pages never repeat or skip a row when many patients share the value they are ordered by', async () => {
    const { token } = await createUser();
    const sameMoment = new Date(2030, 5, 1);
    for (let i = 0; i < 14; i++) await createPatient({ name: 'Same Name', cedula: null, createdAt: sameMoment, birthDate: i < 7 ? '2000-01-01' : null });

    for (const query of [{}, { sort: 'name' }, { sort: 'name', order: 'desc' }, { sort: 'cedula' }, { sort: 'age' }, { sort: 'createdAt', order: 'asc' }]) {
      const seen = [];
      for (let page = 1; page <= 5; page++) {
        const res = await list(token, { ...query, pageSize: 3, page });
        seen.push(...res.body.patients.map((p) => p.id));
      }
      expect(seen).toHaveLength(14);
      expect(new Set(seen).size).toBe(14);
      // and asking again gives the same order
      const again = [];
      for (let page = 1; page <= 5; page++) again.push(...(await list(token, { ...query, pageSize: 3, page })).body.patients.map((p) => p.id));
      expect(again).toEqual(seen);
    }
  });

  it('keeps the search, the filters and the order together', async () => {
    const { user, token } = await createUser();
    const b = await createPatient({ name: 'Zoe Child', birthDate: bornAgo(4) });
    const a = await createPatient({ name: 'Ada Child', birthDate: bornAgo(9) });
    await createPatient({ name: 'Ada Grown', birthDate: bornAgo(40) });
    await consent(user, a);
    await consent(user, b);

    const res = await list(token, { search: 'child', minor: 'true', consent: 'granted', sort: 'name', order: 'desc' });

    expect(names(res)).toEqual(['Zoe Child', 'Ada Child']);
  });
});

describe('invalid parameters', () => {
  it.each([
    [{ consent: 'maybe' }, /consent must be one of: none, granted, outdated, withdrawn/],
    [{ consent: '' }, /consent must be one of/],
    [{ minor: 'yes' }, /minor must be true or false/],
    [{ minor: '1' }, /minor must be true or false/],
    [{ sort: 'password' }, /sort must be one of: name, cedula, phone, age, createdAt/],
    [{ sort: 'consent' }, /sort must be one of/],
    [{ sort: 'appointments' }, /sort must be one of/],
    [{ order: 'up' }, /order must be asc or desc/],
    [{ order: 'DESC' }, /order must be asc or desc/]
  ])('answers 400 for %j', async (query, message) => {
    const { token } = await createUser();

    const res = await list(token, query);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('answers 400 for a parameter sent twice, and never reaches the database with it', async () => {
    const { token } = await createUser();

    const sort = await request(app).get('/api/patients?sort=name&sort=phone').set(bearer(token));
    const consentTwice = await request(app).get('/api/patients?consent=none&consent=granted').set(bearer(token));
    const searchTwice = await request(app).get('/api/patients?search=a&search=b').set(bearer(token));

    for (const res of [sort, consentTwice, searchTwice]) {
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/must be a single value/);
    }
  });

  it('treats an empty or blank search as no search', async () => {
    const { token } = await createUser();
    await createPatient();
    await createPatient();

    const empty = await list(token, { search: '' });
    const blank = await list(token, { search: '   ' });

    expect(empty.body.total).toBe(2);
    expect(blank.body.total).toBe(2);
  });

  it('does not let the filters or the order reach another clinic\'s patients', async () => {
    const { token } = await createUser();
    const other = await createClinic();
    await createPatient({ name: 'Mine' });
    await createPatient({ name: 'Theirs', clinic: other, birthDate: bornAgo(3) });

    for (const query of [{ minor: 'true' }, { consent: 'none' }, { sort: 'name' }, { search: 'theirs' }]) {
      const res = await list(token, query);
      expect(names(res)).not.toContain('Theirs');
    }
  });

  it('still needs a session, and gives the secretary the same list without any clinical data', async () => {
    const noToken = await request(app).get('/api/patients').query({ consent: 'none' });
    expect(noToken.status).toBe(401);

    const { token } = await createUser({ role: 'secretary' });
    const patient = await createPatient({ name: 'Visible' });
    await createAppointment({ doctor: (await createUser()).user, patient, date: '2030-01-01', time: '10:00' });
    const res = await list(token, { sort: 'name', minor: 'false' });

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Visible']);
    expect(JSON.stringify(res.body)).not.toMatch(/allerg|diagnos|vital/i);
  });
});
