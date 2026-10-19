const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { TUESDAY } = require('./helpers/time');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const list = (token, query = {}) => request(app).get('/api/patients').query(query).set(bearer(token));

describe('GET /api/patients', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/patients');

    expect(res.status).toBe(401);
  });

  it('returns a page of patients, newest first, with the paging info', async () => {
    const { token } = await createUser();
    for (let i = 1; i <= 5; i++) await createPatient({ name: `Paciente ${i}`, createdAt: new Date(2030, 0, i) });

    const first = await list(token, { pageSize: 2 });
    const last = await list(token, { pageSize: 2, page: 3 });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 5, page: 1, pageSize: 2, totalPages: 3 });
    expect(first.body.patients.map((p) => p.name)).toEqual(['Paciente 5', 'Paciente 4']);
    expect(last.body.patients.map((p) => p.name)).toEqual(['Paciente 1']);
  });

  it('defaults to 25 per page and never returns more than 100', async () => {
    const { token } = await createUser();

    const byDefault = await list(token);
    const huge = await list(token, { pageSize: 1000 });

    expect(byDefault.body.pageSize).toBe(25);
    expect(huge.body.pageSize).toBe(100);
    expect(byDefault.body).toMatchObject({ patients: [], total: 0, totalPages: 1 });
  });

  it.each([
    [{ page: '0' }, /page must be a positive integer/],
    [{ page: 'abc' }, /page must be a positive integer/],
    [{ page: '1.5' }, /page must be a positive integer/],
    [{ pageSize: '0' }, /pageSize must be a positive integer/],
    [{ pageSize: '-3' }, /pageSize must be a positive integer/],
    [{ page: '2000000', pageSize: '100' }, /page is out of range/]
  ])('returns 400 for %j', async (query, message) => {
    const { token } = await createUser();

    const res = await list(token, query);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('searches by name (any case), phone or cedula', async () => {
    const { token } = await createUser();
    await createPatient({ name: 'María Andrade', phone: '+593991111111', cedula: '1700000001' });
    await createPatient({ name: 'Pedro Loor', phone: '+593992222222', cedula: '1700000002' });

    const byName = await list(token, { search: 'mar' });
    const byPhone = await list(token, { search: '992222' });
    const byCedula = await list(token, { search: '1700000001' });

    expect(byName.body.patients.map((p) => p.name)).toEqual(['María Andrade']);
    expect(byPhone.body.patients.map((p) => p.name)).toEqual(['Pedro Loor']);
    expect(byCedula.body.patients.map((p) => p.name)).toEqual(['María Andrade']);
    expect(byName.body.total).toBe(1);
  });

  it('includes how many appointments each patient has', async () => {
    const { user, token } = await createUser();
    const patient = await createPatient();
    await createAppointment({ doctor: user, patient, date: TUESDAY, time: '09:00' });
    await createAppointment({ doctor: user, patient, date: TUESDAY, time: '10:00' });

    const res = await list(token);

    expect(res.body.patients[0]._count.appointments).toBe(2);
  });
});
