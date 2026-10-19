const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { TUESDAY } = require('./helpers/time');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const api = (method, path, token, body) => {
  const req = request(app)[method](path).set(bearer(token));
  return body ? req.send(body) : req;
};

describe('/api/admin/doctors', () => {
  describe('GET', () => {
    it('is open to admin and secretary but not to doctors', async () => {
      const doctor = await createUser();
      const admin = await createUser({ role: 'admin' });
      const secretary = await createUser({ role: 'secretary' });

      expect((await api('get', '/api/admin/doctors', doctor.token)).status).toBe(403);
      expect((await api('get', '/api/admin/doctors', admin.token)).status).toBe(200);
      expect((await api('get', '/api/admin/doctors', secretary.token)).status).toBe(200);
    });

    it('lists accounts without their password and filters by role', async () => {
      const admin = await createUser({ role: 'admin' });
      const doctor = await createUser({ name: 'Dra. Torres' });

      const all = await api('get', '/api/admin/doctors', admin.token);
      const doctors = await api('get', '/api/admin/doctors?role=doctor', admin.token);

      expect(all.body).toHaveLength(2);
      expect(doctors.body.map((d) => d.id)).toEqual([doctor.user.id]);
      expect(JSON.stringify(all.body)).not.toMatch(/password/);
    });
  });

  describe('POST', () => {
    const valid = { name: 'Dr. Nuevo', email: 'Nuevo@Example.test', password: 'secret123' };

    it('creates an account (admin only), normalises the email and never returns the password', async () => {
      const admin = await createUser({ role: 'admin' });

      const res = await api('post', '/api/admin/doctors', admin.token, valid);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Dr. Nuevo', email: 'nuevo@example.test', role: 'doctor' });
      expect(res.body.password).toBeUndefined();
    });

    it.each(['doctor', 'secretary'])('is forbidden for a %s', async (role) => {
      const user = await createUser({ role });

      const res = await api('post', '/api/admin/doctors', user.token, valid);

      expect(res.status).toBe(403);
      expect(await prisma.doctor.count()).toBe(1);
    });

    it.each([
      [{ name: '  ' }, /Name is required/],
      [{ email: 'not-an-email' }, /valid email/],
      [{ password: '123' }, /at least 6 characters/],
      [{ role: 'superuser' }, /role must be one of/]
    ])('returns 400 for %j', async (override, message) => {
      const admin = await createUser({ role: 'admin' });

      const res = await api('post', '/api/admin/doctors', admin.token, { ...valid, ...override });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    });

    it('rejects an email that is already registered', async () => {
      const admin = await createUser({ role: 'admin', email: 'nuevo@example.test' });

      const res = await api('post', '/api/admin/doctors', admin.token, valid);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Email already registered');
    });
  });

  describe('PUT', () => {
    it('updates only the fields sent and hides the password', async () => {
      const admin = await createUser({ role: 'admin' });
      const doctor = await createUser({ name: 'Dr. Viejo' });

      const res = await api('put', `/api/admin/doctors/${doctor.user.id}`, admin.token, { name: 'Dr. Nuevo' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Dr. Nuevo', email: doctor.user.email });
      expect(res.body.password).toBeUndefined();
    });

    it('returns 400 for an invalid role and 404 for an unknown account', async () => {
      const admin = await createUser({ role: 'admin' });
      const doctor = await createUser();

      const badRole = await api('put', `/api/admin/doctors/${doctor.user.id}`, admin.token, { role: 'root' });
      const unknown = await api('put', '/api/admin/doctors/00000000-0000-4000-8000-000000000000', admin.token, { name: 'X' });

      expect(badRole.status).toBe(400);
      expect(unknown.status).toBe(404);
    });
  });

  describe('DELETE', () => {
    it('deletes an account without appointments, then answers 404', async () => {
      const admin = await createUser({ role: 'admin' });
      const doctor = await createUser();

      const first = await api('delete', `/api/admin/doctors/${doctor.user.id}`, admin.token);
      const again = await api('delete', `/api/admin/doctors/${doctor.user.id}`, admin.token);

      expect(first.status).toBe(200);
      expect(again.status).toBe(404);
    });

    it('does not let an admin delete themselves', async () => {
      const admin = await createUser({ role: 'admin' });

      const res = await api('delete', `/api/admin/doctors/${admin.user.id}`, admin.token);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('You cannot delete yourself');
    });

    it('refuses a doctor that has appointments, even cancelled ones (their history is kept)', async () => {
      const admin = await createUser({ role: 'admin' });
      const doctor = await createUser();
      const patient = await createPatient();
      await createAppointment({ doctor: doctor.user, patient, date: TUESDAY, time: '09:00', status: 'cancelled' });

      const res = await api('delete', `/api/admin/doctors/${doctor.user.id}`, admin.token);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/existing appointments or availability/);
      expect(await prisma.doctor.count()).toBe(2);
    });

    it('is forbidden for a secretary', async () => {
      const secretary = await createUser({ role: 'secretary' });
      const doctor = await createUser();

      const res = await api('delete', `/api/admin/doctors/${doctor.user.id}`, secretary.token);

      expect(res.status).toBe(403);
    });
  });
});

describe('/api/admin/medicos (old name, kept as an alias)', () => {
  it('still answers on every method, and marks the answers as deprecated', async () => {
    const admin = await createUser({ role: 'admin' });

    const created = await api('post', '/api/admin/medicos', admin.token, { name: 'Dr. Alias', email: 'alias@example.test', password: 'secret123' });
    const id = created.body.id;
    const listed = await api('get', '/api/admin/medicos', admin.token);
    const updated = await api('put', `/api/admin/medicos/${id}`, admin.token, { name: 'Dr. Alias 2' });
    const deleted = await api('delete', `/api/admin/medicos/${id}`, admin.token);

    expect([created.status, listed.status, updated.status, deleted.status]).toEqual([201, 200, 200, 200]);
    for (const res of [created, listed, updated, deleted]) {
      expect(res.headers.deprecation).toBe('true');
      expect(res.headers.link).toContain('/api/admin/doctors');
    }
  });

  it('keeps the same access rules', async () => {
    const doctor = await createUser();

    const res = await api('get', '/api/admin/medicos', doctor.token);

    expect(res.status).toBe(403);
  });

  it('is the only one that carries the deprecation header', async () => {
    const admin = await createUser({ role: 'admin' });

    const res = await api('get', '/api/admin/doctors', admin.token);

    expect(res.headers.deprecation).toBeUndefined();
  });
});
