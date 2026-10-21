const request = require('supertest');
const app = require('../src/server');
const { waitForBackgroundWork } = require('../src/services/passwordResetService');
const { recordRead, AUDIT_ACTIONS } = require('../src/services/auditLog');
const { LIMITS } = require('../src/middleware/rateLimiters');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});

afterEach(waitForBackgroundWork);

afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

const UA = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36';
const login = (email, password, userAgent = UA) =>
  request(app).post('/api/auth/login').set('User-Agent', userAgent).send({ email, password });
const entries = (where = {}) => prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'asc' }, { seq: 'asc' }] });
const listFor = (token, query = '') => request(app).get(`/api/admin/audit-log${query}`).set(bearer(token));

describe('sign-ins', () => {
  it('records a successful sign-in of any role, with the clinic, the IP and the browser', async () => {
    const { user } = await createUser({ email: 'doc@example.test', password: 'secret123' });

    const res = await login('doc@example.test', 'secret123');

    expect(res.status).toBe(200);
    expect(await entries()).toEqual([
      expect.objectContaining({
        actorId: user.id,
        actorName: user.name,
        actorRole: 'doctor',
        clinicId: user.clinicId,
        action: 'login',
        entity: 'user',
        entityId: user.id,
        ip: expect.any(String),
        userAgent: UA
      })
    ]);
  });

  it('records a failed sign-in against an existing account, so its clinic can see it', async () => {
    const { user } = await createUser({ email: 'doc@example.test', password: 'secret123' });

    const res = await login('doc@example.test', 'wrong-password');

    expect(res.status).toBe(401);
    expect(await entries()).toEqual([
      expect.objectContaining({ actorId: user.id, clinicId: user.clinicId, action: 'login_failed', entity: 'user', entityId: user.id, userAgent: UA })
    ]);
  });

  it('records nothing for an email with no account (it belongs to no clinic) and never keeps what was typed', async () => {
    const res = await login('ghost@example.test', 'typed-by-someone');

    expect(res.status).toBe(401);
    expect(await entries()).toEqual([]);
  });

  it('never stores the email or the password of an attempt', async () => {
    await createUser({ email: 'doc@example.test', password: 'secret123' });
    await login('doc@example.test', 'not-the-password-xyz');
    await login('doc@example.test', 'secret123');

    const dump = JSON.stringify(await entries());
    expect(dump).not.toMatch(/doc@example|not-the-password|secret123|\$2[aby]\$/);
  });

  it('stops recording once the account is locked out (the attempts are refused before they are checked)', async () => {
    await createUser({ email: 'doc@example.test', password: 'secret123' });

    for (let i = 0; i < LIMITS.loginPerEmail.limit + 3; i++) await login('doc@example.test', 'wrong-password');

    expect(await prisma.auditLog.count({ where: { action: 'login_failed' } })).toBe(LIMITS.loginPerEmail.limit);
  });

  it('keeps only the first 255 characters of the browser', async () => {
    await createUser({ email: 'doc@example.test', password: 'secret123' });

    await login('doc@example.test', 'secret123', 'x'.repeat(400));

    expect((await entries())[0].userAgent).toHaveLength(255);
  });

  it('does not sign anyone in when the record cannot be written', async () => {
    await createUser({ email: 'doc@example.test', password: 'secret123' });
    const spy = jest.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('disk full'));
    jest.spyOn(console, 'error').mockImplementationOnce(() => {});

    const res = await login('doc@example.test', 'secret123');

    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.token).toBeUndefined();
  });
});

describe('password events', () => {
  const change = (token, body) => request(app).post('/api/auth/change-password').set(bearer(token)).send(body);

  it('records a password change made from Settings, and nothing for a wrong current password', async () => {
    const { user, token } = await createUser({ password: 'secret123' });

    const wrong = await change(token, { currentPassword: 'nope-nope', newPassword: 'another-123' });
    const ok = await change(token, { currentPassword: 'secret123', newPassword: 'another-123' });

    expect([wrong.status, ok.status]).toEqual([403, 200]);
    expect((await entries()).map((e) => [e.action, e.actorId, e.entityId])).toEqual([['password_change', user.id, user.id]]);
  });

  it('records a reset made with the emailed link', async () => {
    const { user } = await createUser({ email: 'doc@example.test' });
    await request(app).post('/api/auth/forgot-password').send({ email: 'doc@example.test' });
    await waitForBackgroundWork();
    const mail = notifications.sent.find((m) => m.to === 'doc@example.test');
    const token = mail.text.match(/reset-password\?token=([A-Za-z0-9_-]{43})/)[1];

    const res = await request(app).post('/api/auth/reset-password').set('User-Agent', UA).send({ token, password: 'brand-new-1' });

    expect(res.status).toBe(200);
    expect(await entries()).toEqual([
      expect.objectContaining({ action: 'password_reset', actorId: user.id, clinicId: user.clinicId, userAgent: UA })
    ]);
  });
});

describe('sessions started by an emailed link', () => {
  it('records the sign-in that confirming a sign-up starts, in the new clinic', async () => {
    process.env.EXPOSE_ACCOUNT_LINKS = 'true';
    try {
      const reg = await request(app).post('/api/auth/register').send({ name: 'Dra. Ana', email: 'ana@example.test', password: 'secret123', clinicName: 'Consultorio Ana' });
      const token = reg.body.devLink.match(/token=([A-Za-z0-9_-]{43})/)[1];

      const res = await request(app).post('/api/auth/verify-email').send({ token });

      expect(res.status).toBe(201);
      expect(await entries()).toEqual([
        expect.objectContaining({ action: 'login', actorRole: 'admin', actorId: res.body.user.id, clinicId: res.body.user.clinic.id })
      ]);
    } finally {
      delete process.env.EXPOSE_ACCOUNT_LINKS;
    }
  });

  it('records the sign-in that accepting an invitation starts', async () => {
    process.env.EXPOSE_ACCOUNT_LINKS = 'true';
    try {
      const admin = await createUser({ role: 'admin' });
      const invited = await request(app).post('/api/admin/doctors').set(bearer(admin.token)).send({ name: 'Marta', email: 'marta@example.test', role: 'secretary' });
      const token = invited.body.devLink.match(/token=([A-Za-z0-9_-]{43})/)[1];

      const res = await request(app).post('/api/auth/accept-invitation').send({ token, password: 'secret123' });

      expect(res.status).toBe(201);
      const logins = await entries({ action: 'login' });
      expect(logins).toHaveLength(1);
      expect(logins[0]).toMatchObject({ actorId: res.body.user.id, actorRole: 'secretary', clinicId: admin.user.clinicId });
    } finally {
      delete process.env.EXPOSE_ACCOUNT_LINKS;
    }
  });
});

describe('what an admin can read', () => {
  async function twoClinics() {
    const a = { clinic: await createClinic({ name: 'Clínica A' }) };
    const b = { clinic: await createClinic({ name: 'Clínica B' }) };
    for (const x of [a, b]) {
      x.admin = await createUser({ role: 'admin', clinic: x.clinic, email: `admin-${x.clinic.slug}@example.test`, password: 'secret123' });
      x.doctor = await createUser({ clinic: x.clinic, email: `doc-${x.clinic.slug}@example.test`, password: 'secret123' });
    }
    return { a, b };
  }

  it('shows sign-ins and failed attempts of the people of their own clinic only', async () => {
    const { a, b } = await twoClinics();
    await login(a.doctor.user.email, 'secret123');
    await login(a.doctor.user.email, 'wrong-password');
    await login(b.doctor.user.email, 'secret123');

    const forA = await listFor(a.admin.token);
    const forB = await listFor(b.admin.token);

    expect(forA.body.entries.map((e) => [e.action, e.actor.id])).toEqual([['login_failed', a.doctor.user.id], ['login', a.doctor.user.id]]);
    expect(forB.body.entries.map((e) => [e.action, e.actor.id])).toEqual([['login', b.doctor.user.id]]);
    expect(forA.body.entries[0]).toMatchObject({ entity: 'user', ip: expect.any(String), userAgent: UA, actor: { role: 'doctor' } });
  });

  it('filters by action, by person and by date, and rejects an unknown action', async () => {
    const { a } = await twoClinics();
    await login(a.doctor.user.email, 'secret123');
    await login(a.doctor.user.email, 'wrong-password');
    await login(a.admin.user.email, 'secret123');
    const today = new Date().toISOString().slice(0, 10);

    const failed = await listFor(a.admin.token, '?action=login_failed');
    const person = await listFor(a.admin.token, `?actorId=${a.admin.user.id}`);
    const dated = await listFor(a.admin.token, `?action=login&from=${today}&to=${today}`);
    const bad = await listFor(a.admin.token, '?action=hacked');

    expect(failed.body.entries.map((e) => e.action)).toEqual(['login_failed']);
    expect(person.body.entries.map((e) => e.actor.id)).toEqual([a.admin.user.id]);
    expect(dated.body.total).toBe(2);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('login_failed');
  });

  it('is closed to doctors and secretaries', async () => {
    const { a } = await twoClinics();
    const secretary = await createUser({ role: 'secretary', clinic: a.clinic });

    expect((await listFor(a.doctor.token)).status).toBe(403);
    expect((await listFor(secretary.token)).status).toBe(403);
  });
});

describe('reading a record (prepared for the clinical history)', () => {
  it('can be recorded for any role and read back by an admin of the clinic', async () => {
    const admin = await createUser({ role: 'admin' });
    const doctor = await createUser();
    const req = { doctorId: doctor.user.id, userName: doctor.user.name, userRole: 'doctor', clinicId: doctor.user.clinicId, ip: '10.0.0.1', get: () => UA };

    await recordRead(prisma, req, { entity: 'patient', entityId: 'patient-1', doctorId: doctor.user.id });

    expect(AUDIT_ACTIONS).toContain('read');
    const res = await listFor(admin.token, '?action=read');
    expect(res.body.entries).toEqual([
      expect.objectContaining({ action: 'read', entity: 'patient', entityId: 'patient-1', actor: { id: doctor.user.id, name: doctor.user.name, role: 'doctor' }, ip: '10.0.0.1', userAgent: UA })
    ]);
  });
});
