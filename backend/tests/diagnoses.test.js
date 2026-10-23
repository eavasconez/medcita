const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, createPatient, createAppointment, bearer, tokenFor } = require('./helpers/factories');
const { MONDAY } = require('./helpers/time');
const dx = require('../src/services/diagnoses');
const importer = require('../scripts/importDiagnoses');

// Invented codes and names on purpose: the repository carries no part of the classification.
const SQL_FIXTURE = `﻿INSERT INTO CIE (ID,CIE_ID,VERSIONCIE,CODIGO,NOMBRE,CTSEXO_ID,EDADMIN,UNIDADEDADMIN,EDADMAX,UNIDADEDADMAX,ESTADO) VALUES (
1,NULL,'CIE10','T90','CAPITULO DE PRUEBA',NULL,NULL,NULL,NULL,NULL,0);
INSERT INTO CIE (ID,CIE_ID,VERSIONCIE,CODIGO,NOMBRE,CTSEXO_ID,EDADMIN,UNIDADEDADMIN,EDADMAX,UNIDADEDADMIN,ESTADO) VALUES (
2,1,'CIE10','T900','DIAGNOSTICO DE PRUEBA UNO',NULL,NULL,NULL,NULL,NULL,1);
INSERT INTO CIE (ID,CIE_ID,VERSIONCIE,CODIGO,NOMBRE,CTSEXO_ID,EDADMIN,UNIDADEDADMIN,EDADMAX,UNIDADEDADMAX,ESTADO) VALUES (
3,1,'CIE10','T901','OTRO DIAGNOSTICO DE PRUEBA, "CON COMILLAS" Y D''ARTAGNAN',NULL,28,'D',120,'A',1);
INSERT INTO CIE (ID,CIE_ID,VERSIONCIE,CODIGO,NOMBRE,CTSEXO_ID,EDADMIN,UNIDADEDADMIN,EDADMAX,UNIDADEDADMAX,ESTADO) VALUES (
4,NULL,'CIE10','U99','SINDROME INVENTADO DE LA ÑANDU',NULL,NULL,NULL,NULL,NULL,1);
`;

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('code helpers', () => {
  it.each([
    ['a00.0', 'A00.0'], ['A000', 'A00.0'], [' a00 0 ', 'A00.0'], ['A00', 'A00'], ['s0601', 'S06.01'], ['e11.9', 'E11.9']
  ])('formats %s as %s', (input, expected) => expect(dx.formatCode(input)).toBe(expected));

  it.each([['A00', true], ['a00.0', true], ['S06.01', true], ['00A', false], ['A0', false], ['hello', false], ['', false], ['A00.000', false]])(
    'isCode(%s) is %s', (input, expected) => expect(dx.isCode(input)).toBe(expected)
  );

  it('normalizes accents and case for searching', () => {
    expect(dx.normalize('CÓLERA Ñandú')).toBe('colera nandu');
    expect(dx.normalize(null)).toBe('');
  });
});

describe('reading a catalogue file', () => {
  it('reads the SQL of the Ministry: BOM, quotes, accents, the point in the code', () => {
    const rows = dx.parseCatalog(SQL_FIXTURE);

    expect(rows.map((r) => r.code)).toEqual(['T90', 'T90.0', 'T90.1', 'U99']);
    expect(rows[2].name).toBe('OTRO DIAGNOSTICO DE PRUEBA, "CON COMILLAS" Y D\'ARTAGNAN');
    expect(rows[3].name).toBe('SINDROME INVENTADO DE LA ÑANDU');
  });

  it('reads a CSV with ; , or tab, skips the header and quotes', () => {
    const csv = 'code;name\nT90.0;Diagnóstico uno\n"T90.1","Diagnóstico, dos"\nU99\tTres\n\n';
    expect(dx.parseCatalog(csv)).toEqual([
      { code: 'T90.0', name: 'Diagnóstico uno' },
      { code: 'T90.1', name: 'Diagnóstico, dos' },
      { code: 'U99', name: 'Tres' }
    ]);
  });

  it('ignores lines that are not codes or have no name', () => {
    expect(dx.parseCatalog('hello;world\nT90;\n;x\nT91;Ok')).toEqual([{ code: 'T91', name: 'Ok' }]);
    expect(dx.parseCatalog('')).toEqual([]);
  });

  it('builds the rows: a code that is split further is a heading, duplicates keep the first name', () => {
    const rows = dx.buildCatalog(dx.parseCatalog(`${SQL_FIXTURE}\nT90.0;Repetido`));
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));

    expect(rows).toHaveLength(4);
    expect(byCode.T90).toMatchObject({ level: 'category', selectable: false, codeKey: 'T90' });
    expect(byCode['T90.0']).toMatchObject({ level: 'subcategory', selectable: true, codeKey: 'T900', name: 'DIAGNOSTICO DE PRUEBA UNO', searchText: 'diagnostico de prueba uno' });
    expect(byCode.U99).toMatchObject({ level: 'category', selectable: true, searchText: 'sindrome inventado de la nandu' });
    expect(byCode.U99).toMatchObject({ source: 'msp-rdacaa', version: 'CIE10' });
  });
});

describe('the import command', () => {
  let dir;
  const out = [];
  const log = (line) => out.push(line);
  const env = () => ({ DATABASE_URL: process.env.DATABASE_URL });
  const fixture = (name, content) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dx-'));
    out.length = 0;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('loads the catalogue and says how many codes', async () => {
    expect(await importer.main([fixture('cie.sql', SQL_FIXTURE)], env(), log)).toBe(0);

    expect(await prisma.diagnosisCode.count()).toBe(4);
    expect(out.join('\n')).toMatch(/Loaded 4 codes \(3 selectable\) as source "msp-rdacaa"/);
  });

  it('can be run again: the rows of the same source are replaced, not duplicated', async () => {
    const file = fixture('cie.sql', SQL_FIXTURE);
    await importer.main([file], env(), log);
    await importer.main([file], env(), log);
    expect(await prisma.diagnosisCode.count()).toBe(4);

    await importer.main([fixture('new.csv', 'T95.0;Solo este')], env(), log);
    expect((await prisma.diagnosisCode.findMany()).map((r) => r.code)).toEqual(['T95.0']);
  });

  it('leaves the rows of another source alone', async () => {
    await importer.main([fixture('a.csv', 'T91.0;Uno'), '--source', 'other'], env(), log);
    await importer.main([fixture('b.csv', 'T92.0;Dos')], env(), log);

    expect((await prisma.diagnosisCode.findMany({ orderBy: { code: 'asc' } })).map((r) => [r.code, r.source])).toEqual([['T91.0', 'other'], ['T92.0', 'msp-rdacaa']]);
  });

  it('does not touch the diagnoses already written in notes', async () => {
    const ctx = await setupNote();
    await importer.main([fixture('a.csv', 'T90.0;Diagnostico uno')], env(), log);
    await request(app).post(notePath(ctx, '/diagnoses')).set(bearer(ctx.doctor.token)).send({ code: 'T90.0' });

    await importer.main([fixture('b.csv', 'T99.0;Otro')], env(), log);

    expect(await prisma.consultationDiagnosis.findMany({ select: { code: true, name: true } })).toEqual([{ code: 'T90.0', name: 'Diagnostico uno' }]);
  });

  it.each([
    [[], /Usage/],
    [['/nonexistent/file.sql'], /does not exist/]
  ])('refuses %j', async (argv, message) => {
    expect(await importer.main(argv, env(), log)).toBe(1);
    expect(out.join('\n')).toMatch(message);
  });

  it('refuses a file with no codes and loads nothing', async () => {
    expect(await importer.main([fixture('x.txt', 'nothing here')], env(), log)).toBe(1);
    expect(out.join('\n')).toMatch(/no codes/);
    expect(await prisma.diagnosisCode.count()).toBe(0);
  });

  it('refuses a database that is not local unless its host is named', async () => {
    const remote = { DATABASE_URL: 'postgresql://u:p@ep-prod-1.us-east-2.aws.neon.tech/neondb' };
    const file = fixture('cie.sql', SQL_FIXTURE);

    expect(await importer.main([file], remote, log)).toBe(1);
    expect(out.join('\n')).toMatch(/DIAGNOSES_IMPORT_HOST=ep-prod-1\.us-east-2\.aws\.neon\.tech/);
    expect(await importer.main([file], { ...remote, DIAGNOSES_IMPORT_HOST: 'other-host' }, log)).toBe(1);
    expect(await importer.main([file], {}, log)).toBe(1);
  });

  it('reads the options', () => {
    expect(importer.parseArgs(['f.sql', '--source', 's', '--version', 'v'])).toEqual({ file: 'f.sql', source: 's', version: 'v' });
    expect(importer.parseArgs(['f.sql'])).toEqual({ file: 'f.sql', source: 'msp-rdacaa', version: 'CIE10' });
  });
});

const load = async () => prisma.diagnosisCode.createMany({ data: dx.buildCatalog(dx.parseCatalog(SQL_FIXTURE)) });
const search = (token, q, extra = '') => request(app).get(`/api/diagnoses/search?q=${encodeURIComponent(q)}${extra}`).set(bearer(token));

describe('GET /api/diagnoses/search', () => {
  it.each(['doctor', 'admin'])('a %s finds a diagnosis by words, ignoring accents and case', async (role) => {
    await load();
    const { token } = await createUser({ role });

    const res = await search(token, 'DIAGNÓSTICO prueba');

    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.code)).toEqual(['T90.0', 'T90.1']);
    expect(res.body[0]).toEqual({ code: 'T90.0', name: 'DIAGNOSTICO DE PRUEBA UNO', level: 'subcategory' });
  });

  it('every word has to be in the name', async () => {
    await load();
    const { token } = await createUser();
    expect((await search(token, 'prueba uno')).body.map((r) => r.code)).toEqual(['T90.0']);
    expect((await search(token, 'prueba zzz')).body).toEqual([]);
  });

  it.each(['t90', 'T90.', 't90.0', 'T900', ' t 90 '])('finds by code, written as %j', async (q) => {
    await load();
    const { token } = await createUser();

    const res = await search(token, q);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((r) => r.code.startsWith('T90'))).toBe(true);
  });

  it('leaves the headings out: T90 is split, U99 is not', async () => {
    await load();
    const { token } = await createUser();
    expect((await search(token, 't90')).body.map((r) => r.code)).toEqual(['T90.0', 'T90.1']);
    expect((await search(token, 'u99')).body.map((r) => r.code)).toEqual(['U99']);
    expect((await search(token, 'ñandu')).body.map((r) => r.code)).toEqual(['U99']);
  });

  it('respects the limit', async () => {
    await load();
    const { token } = await createUser();
    expect((await search(token, 't90', '&limit=1')).body).toHaveLength(1);
  });

  it.each([['a', ''], ['', ''], ['t90', '&limit=0'], ['t90', '&limit=51'], ['t90', '&limit=x']])('refuses q=%j%s', async (q, extra) => {
    const { token } = await createUser();
    expect((await search(token, q, extra)).status).toBe(400);
  });

  it('is not for the secretary, nor without a token', async () => {
    await load();
    const secretary = await createUser({ role: 'secretary' });
    expect((await search(secretary.token, 't90')).status).toBe(403);
    expect((await request(app).get('/api/diagnoses/search?q=t90')).status).toBe(401);
  });

  it('a doctor turned secretary is refused with the old token', async () => {
    const { user } = await createUser({ role: 'doctor' });
    const stale = tokenFor(user);
    await prisma.doctor.update({ where: { id: user.id }, data: { role: 'secretary' } });
    expect((await search(stale, 't90')).status).toBe(403);
  });

  it('is the same list for every clinic', async () => {
    await load();
    const other = await createUser({ role: 'doctor', clinic: await createClinic() });
    expect((await search(other.token, 't90')).body).toHaveLength(2);
  });
});

describe('GET /api/diagnoses/status', () => {
  it('says the list is empty until it is loaded, and how it was loaded after', async () => {
    const { token } = await createUser();
    expect((await request(app).get('/api/diagnoses/status').set(bearer(token))).body).toEqual({ loaded: 0, sources: [] });

    await load();

    expect((await request(app).get('/api/diagnoses/status').set(bearer(token))).body).toEqual({ loaded: 4, sources: [{ source: 'msp-rdacaa', version: 'CIE10', codes: 4 }] });
  });

  it('is not for the secretary', async () => {
    const { token } = await createUser({ role: 'secretary' });
    expect((await request(app).get('/api/diagnoses/status').set(bearer(token))).status).toBe(403);
  });
});

// --- the diagnoses of a note ---------------------------------------------------------------

const notePath = (ctx, rest = '') => `/api/patients/${ctx.patient.id}/clinical/notes/${ctx.note.id}${rest}`;
const addDx = (token, ctx, body) => request(app).post(notePath(ctx, '/diagnoses')).set(bearer(token)).send(body);
const putDx = (token, ctx, id, body) => request(app).put(notePath(ctx, `/diagnoses/${id}`)).set(bearer(token)).send(body);
const delDx = (token, ctx, id) => request(app).delete(notePath(ctx, `/diagnoses/${id}`)).set(bearer(token));
const readNote = (token, ctx) => request(app).get(notePath(ctx)).set(bearer(token));

async function setupNote() {
  const clinic = await createClinic();
  const doctor = await createUser({ role: 'doctor', clinic, name: 'Dra. Vega' });
  const patient = await createPatient({ clinic });
  const appointment = await createAppointment({ doctor: doctor.user, patient, date: MONDAY, time: '09:00', status: 'in_progress' });
  const created = await request(app).post(`/api/patients/${patient.id}/clinical/notes`).set(bearer(doctor.token)).send({ appointmentId: appointment.id, template: 'blank' });
  return { clinic, doctor, patient, appointment, note: created.body };
}

const closeNote = async (ctx) => {
  await request(app).put(notePath(ctx)).set(bearer(ctx.doctor.token)).send({ revision: 1, plan: 'Reposo' });
  return request(app).post(notePath(ctx, '/close')).set(bearer(ctx.doctor.token)).send({ revision: 2 });
};

describe('diagnoses of a note', () => {
  beforeEach(load);

  it('adds one from the catalogue: code and name are copied, whatever the body says', async () => {
    const ctx = await setupNote();

    const res = await addDx(ctx.doctor.token, ctx, { code: 't90.0', name: 'Lo que sea', kind: 'primary', certainty: 'definitive' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'T90.0', name: 'DIAGNOSTICO DE PRUEBA UNO', kind: 'primary', certainty: 'definitive', recordedByName: 'Dra. Vega', noteId: ctx.note.id });
  });

  it('defaults to a secondary, presumptive diagnosis', async () => {
    const ctx = await setupNote();
    expect((await addDx(ctx.doctor.token, ctx, { code: 'T90.1' })).body).toMatchObject({ kind: 'secondary', certainty: 'presumptive' });
  });

  it('adds a free-text diagnosis when it is not in the list', async () => {
    const ctx = await setupNote();

    const res = await addDx(ctx.doctor.token, ctx, { name: '  Cefalea tensional  ' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: null, name: 'Cefalea tensional' });
    expect((await addDx(ctx.doctor.token, ctx, { name: 'Cefalea tensional' })).status).toBe(201);
  });

  it.each([
    [{ code: 'hello' }, /valid ICD-10 code/],
    [{ code: 'Z99.9' }, /not in the diagnosis list/],
    [{ code: 'T90' }, /not in the diagnosis list/],
    [{ code: 5 }, /valid ICD-10 code/],
    [{}, /Pick a diagnosis/],
    [{ name: '   ' }, /Pick a diagnosis/],
    [{ name: 'x'.repeat(301) }, /at most 300/],
    [{ code: 'T90.0', kind: 'main' }, /kind must be one of/],
    [{ code: 'T90.0', certainty: 'maybe' }, /certainty must be one of/]
  ])('refuses %j', async (body, message) => {
    const ctx = await setupNote();
    const res = await addDx(ctx.doctor.token, ctx, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await prisma.consultationDiagnosis.count()).toBe(0);
  });

  it('the same code twice in a note is refused', async () => {
    const ctx = await setupNote();
    await addDx(ctx.doctor.token, ctx, { code: 'T90.0' });

    const res = await addDx(ctx.doctor.token, ctx, { code: 'T900' });

    expect(res.status).toBe(409);
    expect(await prisma.consultationDiagnosis.count()).toBe(1);
  });

  it('a note has one main diagnosis: a new one takes the place of the old, also when changed', async () => {
    const ctx = await setupNote();
    const first = (await addDx(ctx.doctor.token, ctx, { code: 'T90.0', kind: 'primary' })).body;
    const second = (await addDx(ctx.doctor.token, ctx, { code: 'T90.1', kind: 'primary' })).body;

    let rows = await prisma.consultationDiagnosis.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.code, r.kind])).toEqual([['T90.0', 'secondary'], ['T90.1', 'primary']]);

    await putDx(ctx.doctor.token, ctx, first.id, { kind: 'primary' });

    rows = await prisma.consultationDiagnosis.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.code, r.kind])).toEqual([['T90.0', 'primary'], ['T90.1', 'secondary']]);
    expect(second.id).toBeTruthy();
  });

  it('refuses the 21st diagnosis', async () => {
    const ctx = await setupNote();
    for (let i = 0; i < 20; i += 1) await addDx(ctx.doctor.token, ctx, { name: `Diagnóstico libre ${i}` });

    expect((await addDx(ctx.doctor.token, ctx, { name: 'Uno más' })).status).toBe(409);
    expect(await prisma.consultationDiagnosis.count()).toBe(20);
  });

  it('changes the certainty and the name of a free-text diagnosis, not the name of a coded one', async () => {
    const ctx = await setupNote();
    const coded = (await addDx(ctx.doctor.token, ctx, { code: 'T90.0' })).body;
    const free = (await addDx(ctx.doctor.token, ctx, { name: 'Cefalea' })).body;

    expect((await putDx(ctx.doctor.token, ctx, coded.id, { certainty: 'definitive' })).body.certainty).toBe('definitive');
    expect((await putDx(ctx.doctor.token, ctx, free.id, { name: 'Cefalea tensional' })).body.name).toBe('Cefalea tensional');
    const refused = await putDx(ctx.doctor.token, ctx, coded.id, { name: 'Otro nombre' });
    expect(refused.status).toBe(400);
    expect((await prisma.consultationDiagnosis.findUnique({ where: { id: coded.id } })).name).toBe('DIAGNOSTICO DE PRUEBA UNO');
    expect((await putDx(ctx.doctor.token, ctx, free.id, { kind: 'x' })).status).toBe(400);
    expect((await putDx(ctx.doctor.token, ctx, '00000000-0000-0000-0000-000000000000', { kind: 'primary' })).status).toBe(404);
  });

  it('removes one', async () => {
    const ctx = await setupNote();
    const { body } = await addDx(ctx.doctor.token, ctx, { code: 'T90.0' });

    expect((await delDx(ctx.doctor.token, ctx, body.id)).status).toBe(200);
    expect((await delDx(ctx.doctor.token, ctx, body.id)).status).toBe(404);
    expect(await prisma.consultationDiagnosis.count()).toBe(0);
  });

  it('only the author of the draft changes its diagnoses: not another doctor, not an admin', async () => {
    const ctx = await setupNote();
    const mine = (await addDx(ctx.doctor.token, ctx, { code: 'T90.0' })).body;
    const colleague = await createUser({ role: 'doctor', clinic: ctx.clinic });
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic });

    for (const user of [colleague, admin]) {
      expect((await addDx(user.token, ctx, { code: 'T90.1' })).status).toBe(403);
      expect((await putDx(user.token, ctx, mine.id, { kind: 'primary' })).status).toBe(403);
      expect((await delDx(user.token, ctx, mine.id)).status).toBe(403);
    }
    expect(await prisma.consultationDiagnosis.count()).toBe(1);
  });

  it('once the note is closed they are final', async () => {
    const ctx = await setupNote();
    const mine = (await addDx(ctx.doctor.token, ctx, { code: 'T90.0', kind: 'primary' })).body;
    expect((await closeNote(ctx)).status).toBe(200);

    expect((await addDx(ctx.doctor.token, ctx, { code: 'T90.1' })).status).toBe(409);
    expect((await putDx(ctx.doctor.token, ctx, mine.id, { certainty: 'definitive' })).status).toBe(409);
    expect((await delDx(ctx.doctor.token, ctx, mine.id)).status).toBe(409);
    expect(await prisma.consultationDiagnosis.count()).toBe(1);
  });

  it('is refused to the secretary and to another clinic, and changes nothing', async () => {
    const ctx = await setupNote();
    const mine = (await addDx(ctx.doctor.token, ctx, { code: 'T90.0' })).body;
    const secretary = await createUser({ role: 'secretary', clinic: ctx.clinic });
    const outsider = await createUser({ role: 'doctor', clinic: await createClinic() });

    for (const [user, status] of [[secretary, 403], [outsider, 404]]) {
      expect((await addDx(user.token, ctx, { code: 'T90.1' })).status).toBe(status);
      expect((await putDx(user.token, ctx, mine.id, { kind: 'primary' })).status).toBe(status);
      expect((await delDx(user.token, ctx, mine.id)).status).toBe(status);
    }
    expect((await request(app).post(notePath(ctx, '/diagnoses')).send({ code: 'T90.1' })).status).toBe(401);
    expect(await prisma.consultationDiagnosis.count()).toBe(1);
  });

  it('a diagnosis of another note cannot be reached through this one', async () => {
    const ctx = await setupNote();
    const second = await createAppointment({ doctor: ctx.doctor.user, patient: ctx.patient, date: MONDAY, time: '10:00' });
    const other = (await request(app).post(`/api/patients/${ctx.patient.id}/clinical/notes`).set(bearer(ctx.doctor.token)).send({ appointmentId: second.id, template: 'blank' })).body;
    const theirs = (await request(app).post(`/api/patients/${ctx.patient.id}/clinical/notes/${other.id}/diagnoses`).set(bearer(ctx.doctor.token)).send({ code: 'T90.0' })).body;

    expect((await putDx(ctx.doctor.token, ctx, theirs.id, { kind: 'primary' })).status).toBe(404);
    expect((await delDx(ctx.doctor.token, ctx, theirs.id)).status).toBe(404);
    expect(await prisma.consultationDiagnosis.count()).toBe(1);
  });

  it('comes with the note, the main one first, and the list shows the main one without opening the note', async () => {
    const ctx = await setupNote();
    await addDx(ctx.doctor.token, ctx, { code: 'T90.1' });
    await addDx(ctx.doctor.token, ctx, { code: 'T90.0', kind: 'primary' });

    const note = (await readNote(ctx.doctor.token, ctx)).body;
    expect(note.diagnoses.map((d) => d.code)).toEqual(['T90.0', 'T90.1']);

    const list = await request(app).get(`/api/patients/${ctx.patient.id}/clinical/notes`).set(bearer(ctx.doctor.token));
    expect(list.body[0].principalDiagnosis).toEqual({ code: 'T90.0', name: 'DIAGNOSTICO DE PRUEBA UNO' });
    expect(list.body[0]).not.toHaveProperty('diagnoses');
  });

  it('a note without a main diagnosis has none in the list', async () => {
    const ctx = await setupNote();
    await addDx(ctx.doctor.token, ctx, { code: 'T90.1' });
    const list = await request(app).get(`/api/patients/${ctx.patient.id}/clinical/notes`).set(bearer(ctx.doctor.token));
    expect(list.body[0].principalDiagnosis).toBeNull();
  });

  it('a draft deleted by mistake takes its diagnoses with it; a closed note is never deleted and keeps them', async () => {
    const ctx = await setupNote();
    await addDx(ctx.doctor.token, ctx, { code: 'T90.0' });

    expect((await request(app).delete(notePath(ctx)).set(bearer(ctx.doctor.token))).status).toBe(200);
    expect(await prisma.consultationDiagnosis.count()).toBe(0);

    const again = await setupNote();
    await addDx(again.doctor.token, again, { code: 'T90.0' });
    await closeNote(again);
    expect((await request(app).delete(notePath(again)).set(bearer(again.doctor.token))).status).toBe(409);
    expect(await prisma.consultationDiagnosis.count()).toBe(1);
  });

  it('a note keeps saying what it said if the catalogue changes later', async () => {
    const ctx = await setupNote();
    await addDx(ctx.doctor.token, ctx, { code: 'T90.0' });
    await closeNote(ctx);

    await prisma.diagnosisCode.deleteMany();

    const note = (await readNote(ctx.doctor.token, ctx)).body;
    expect(note.diagnoses[0]).toMatchObject({ code: 'T90.0', name: 'DIAGNOSTICO DE PRUEBA UNO' });
  });

  it('are part of the export of the patient', async () => {
    const ctx = await setupNote();
    await addDx(ctx.doctor.token, ctx, { code: 'T90.0', kind: 'primary' });
    const admin = await createUser({ role: 'admin', clinic: ctx.clinic });

    const res = await request(app).get(`/api/patients/${ctx.patient.id}/export`).set(bearer(admin.token));

    expect(res.body.consultationNotes[0].diagnoses[0]).toMatchObject({ code: 'T90.0', kind: 'primary' });
  });

  it('the database refuses the same code twice in a note and a diagnosis for a patient of another clinic', async () => {
    const ctx = await setupNote();
    const base = { noteId: ctx.note.id, patientId: ctx.patient.id, clinicId: ctx.clinic.id, name: 'x', recordedById: ctx.doctor.user.id, recordedByName: 'x' };
    await prisma.consultationDiagnosis.create({ data: { ...base, code: 'T90.0' } });

    await expect(prisma.consultationDiagnosis.create({ data: { ...base, code: 'T90.0' } })).rejects.toMatchObject({ code: 'P2002' });
    const other = await createClinic();
    await expect(prisma.consultationDiagnosis.create({ data: { ...base, code: 'T90.1', clinicId: other.id } })).rejects.toMatchObject({ code: 'P2003' });
  });
});
