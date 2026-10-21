const crypto = require('crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../src/server');
const { hashToken } = require('../src/services/passwordResetService');
const { LIMITS } = require('../src/middleware/rateLimiters');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, bearer } = require('./helpers/factories');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const LIMIT = LIMITS.changePasswordPerAccount.limit;
const NEW_PASSWORD = 'a-brand-new-password';

const changePassword = (token, body) => request(app).post('/api/auth/change-password').set(bearer(token)).send(body);
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const profile = (token) => request(app).get('/api/auth/profile').set(bearer(token));
const reload = (id) => prisma.doctor.findUnique({ where: { id } });

// A token the account was given `secondsAgo` seconds ago, i.e. before whatever
// the test is about to do to the password.
const tokenIssuedAgo = (doctor, secondsAgo = 120) =>
  jwt.sign({ id: doctor.id, role: doctor.role, iat: Math.floor(Date.now() / 1000) - secondsAgo }, process.env.JWT_SECRET, {
    expiresIn: '1d'
  });

describe('POST /api/auth/change-password', () => {
  it('changes the password: the old one stops working and the new one logs in', async () => {
    const { user, token, password } = await createUser();

    const res = await changePassword(token, { currentPassword: password, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password updated successfully');
    expect((await login(user.email, password)).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('stores the new password hashed and records when it changed', async () => {
    const { user, token, password } = await createUser();
    const before = Date.now();

    await changePassword(token, { currentPassword: password, newPassword: NEW_PASSWORD });

    const stored = await reload(user.id);
    expect(stored.password).not.toBe(NEW_PASSWORD);
    expect(await bcrypt.compare(NEW_PASSWORD, stored.password)).toBe(true);
    expect(stored.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('answers with a fresh token that works right away, and never with a password', async () => {
    const { user, token, password } = await createUser();

    const res = await changePassword(token, { currentPassword: password, newPassword: NEW_PASSWORD });

    expect(res.body.user).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      clinic: { id: user.clinicId, name: 'Consultorio de pruebas' }
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password"|\$2[aby]\$/);
    expect((await profile(res.body.token)).status).toBe(200);
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).post('/api/auth/change-password').send({ currentPassword: 'x', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(401);
  });

  describe('when the current password is wrong', () => {
    it('answers 403 (not 401, which the app reads as an expired session) and changes nothing', async () => {
      const { user, token, password } = await createUser();

      const res = await changePassword(token, { currentPassword: 'not-my-password', newPassword: NEW_PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Current password is incorrect');
      expect(await bcrypt.compare(password, (await reload(user.id)).password)).toBe(true);
      expect((await reload(user.id)).passwordChangedAt).toBeNull();
      expect((await profile(token)).status).toBe(200);
    });
  });

  describe('validation', () => {
    it.each([
      ['a missing current password', { newPassword: NEW_PASSWORD }, 'Current password is required'],
      ['an empty current password', { currentPassword: '', newPassword: NEW_PASSWORD }, 'Current password is required'],
      ['a current password that is not text', { currentPassword: 123456, newPassword: NEW_PASSWORD }, 'Current password is required'],
      ['a missing new password', { currentPassword: 'secret123' }, 'Password must be at least 6 characters'],
      ['a new password that is too short', { currentPassword: 'secret123', newPassword: '12345' }, 'Password must be at least 6 characters'],
      ['a new password that is not text', { currentPassword: 'secret123', newPassword: 1234567 }, 'Password must be at least 6 characters'],
      ['the same password again', { currentPassword: 'secret123', newPassword: 'secret123' }, 'The new password must be different from the current one']
    ])('answers 400 for %s and changes nothing', async (_label, body, message) => {
      const { user, token } = await createUser({ password: 'secret123' });

      const res = await changePassword(token, body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(message);
      expect((await reload(user.id)).passwordChangedAt).toBeNull();
      expect((await login(user.email, 'secret123')).status).toBe(200);
    });

    it('answers 400 when there is no body at all', async () => {
      const { token } = await createUser();

      const res = await request(app).post('/api/auth/change-password').set(bearer(token));

      expect(res.status).toBe(400);
    });
  });

  describe('rate limiting', () => {
    const failTimes = async (token, times) => {
      for (let i = 0; i < times; i++) {
        expect((await changePassword(token, { currentPassword: 'wrong-password', newPassword: NEW_PASSWORD })).status).toBe(403);
      }
    };

    it(`blocks the account after ${LIMIT} wrong current passwords, even with the right one`, async () => {
      const { user, token, password } = await createUser();
      await failTimes(token, LIMIT);

      const res = await changePassword(token, { currentPassword: password, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/^Too many incorrect attempts to change the password\. Please try again in \d+ minutes?\.$/);
      expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
      expect(await bcrypt.compare(password, (await reload(user.id)).password)).toBe(true);
    });

    it('does not count validation errors or successful changes', async () => {
      const { token, password } = await createUser();
      for (let i = 0; i < LIMIT + 2; i++) {
        expect((await changePassword(token, { currentPassword: password, newPassword: '123' })).status).toBe(400);
      }
      await failTimes(token, LIMIT - 1);

      const res = await changePassword(token, { currentPassword: password, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(200);
    });

    it('is counted per account: one locked account does not lock another', async () => {
      const victim = await createUser();
      const other = await createUser();
      await failTimes(victim.token, LIMIT);

      const res = await changePassword(other.token, { currentPassword: other.password, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(200);
    });
  });
});

describe('sessions opened before a password change', () => {
  it('stop working once the password is changed from Settings, while the new session keeps going', async () => {
    const { user, password } = await createUser();
    const otherDevice = tokenIssuedAgo(user);
    const thisDevice = tokenIssuedAgo(user, 30);
    expect((await profile(otherDevice)).status).toBe(200);

    const res = await changePassword(thisDevice, { currentPassword: password, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    for (const stale of [otherDevice, thisDevice]) {
      const rejected = await profile(stale);
      expect(rejected.status).toBe(401);
      expect(rejected.body.error).toBe('Invalid token');
    }
    expect((await profile(res.body.token)).status).toBe(200);
    expect((await profile((await login(user.email, NEW_PASSWORD)).body.token)).status).toBe(200);
  });

  it('stop working once the password is reset from the emailed link', async () => {
    const { user } = await createUser();
    const stale = tokenIssuedAgo(user);
    const link = crypto.randomBytes(32).toString('base64url');
    await prisma.passwordResetToken.create({
      data: { doctorId: user.id, tokenHash: hashToken(link), expiresAt: new Date(Date.now() + 60 * 60 * 1000) }
    });

    const reset = await request(app).post('/api/auth/reset-password').send({ token: link, password: NEW_PASSWORD });

    expect(reset.status).toBe(200);
    expect((await profile(stale)).status).toBe(401);
    expect((await profile((await login(user.email, NEW_PASSWORD)).body.token)).status).toBe(200);
  });

  describe('when an admin edits the account', () => {
    const adminUpdate = (adminToken, id, body) =>
      request(app).put(`/api/admin/doctors/${id}`).set(bearer(adminToken)).send(body);

    it('keep working: an admin can no longer set a password, so nobody is signed out that way', async () => {
      const admin = await createUser({ role: 'admin' });
      const { user } = await createUser();
      const session = tokenIssuedAgo(user);

      const res = await adminUpdate(admin.token, user.id, { password: NEW_PASSWORD });

      expect(res.status).toBe(400);
      expect((await profile(session)).status).toBe(200);
    });

    it('keep working when the admin edits something else', async () => {
      const admin = await createUser({ role: 'admin' });
      const { user } = await createUser();
      const session = tokenIssuedAgo(user);

      const res = await adminUpdate(admin.token, user.id, { name: 'Nuevo Nombre' });

      expect(res.status).toBe(200);
      expect((await profile(session)).status).toBe(200);
    });
  });

  it('keep working for accounts whose password never changed', async () => {
    const { user } = await createUser();

    expect((await profile(tokenIssuedAgo(user, 3600))).status).toBe(200);
  });

  it('only affects the account whose password changed', async () => {
    const changed = await createUser();
    const untouched = await createUser();
    const untouchedSession = tokenIssuedAgo(untouched.user);

    await changePassword(changed.token, { currentPassword: changed.password, newPassword: NEW_PASSWORD });

    expect((await profile(untouchedSession)).status).toBe(200);
  });

  it('are rejected on every protected route, not just the profile', async () => {
    const { user, password, token } = await createUser();
    const stale = tokenIssuedAgo(user);
    await changePassword(token, { currentPassword: password, newPassword: NEW_PASSWORD });

    for (const path of ['/api/appointments', '/api/patients', '/api/availability']) {
      expect((await request(app).get(path).set(bearer(stale))).status).toBe(401);
    }
  });
});

describe('the auth lookup', () => {
  it('answers 500, not 401, when the database fails, so a hiccup does not sign everyone out', async () => {
    const { token } = await createUser();
    const lookup = jest.spyOn(prisma.doctor, 'findUnique').mockRejectedValueOnce(new Error('connection lost'));
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await profile(token);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('An unexpected error occurred');
    lookup.mockRestore();
    logged.mockRestore();
  });
});
