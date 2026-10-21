const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const { SIGNUP_TTL_HOURS, waitForBackgroundWork } = require('../src/services/signupService');
const { hashToken } = require('../src/utils/tokens');
const { LIMITS } = require('../src/middleware/rateLimiters');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});

// The endpoint does its work after answering; let it finish before the next test wipes the tables.
afterEach(waitForBackgroundWork);

afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

const valid = { name: 'Dra. Ana Torres', email: 'ana@example.test', password: 'secret123', clinicName: 'Consultorio Torres' };
const INVALID_LINK_CODE = 'INVALID_LINK';
const TOKEN_IN_TEXT = /verify-email\?token=([A-Za-z0-9_-]{43})/;

const register = (body = valid) => request(app).post('/api/auth/register').send(body);
const verify = (token) => request(app).post('/api/auth/verify-email').send({ token });

const emailsTo = (to) => notifications.sent.filter((m) => m.channel === 'email' && m.to === to);

// Sign up the way a person would and return the token from the email they get.
async function signUp(body = valid) {
  const res = await register(body);
  expect(res.status).toBe(202);
  await waitForBackgroundWork();
  const mails = emailsTo(body.email.trim().toLowerCase());
  return mails[mails.length - 1].text.match(TOKEN_IN_TEXT)[1];
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const storeRequest = (token, overrides = {}) =>
  prisma.signupRequest.create({
    data: {
      tokenHash: hashToken(token),
      name: 'Dr. Guardado',
      email: 'guardado@example.test',
      clinicName: 'Consultorio Guardado',
      passwordHash: bcrypt.hashSync('secret123', 4),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides
    }
  });

describe('POST /api/auth/register', () => {
  it('answers 202 and creates nothing until the email is confirmed', async () => {
    const res = await register();

    expect(res.status).toBe(202);
    expect(res.body.message).toMatch(/^Check your email/);
    expect(res.body.token).toBeUndefined();
    await waitForBackgroundWork();
    expect(await prisma.doctor.count()).toBe(0);
    expect(await prisma.clinic.count()).toBe(0);
    expect(await prisma.signupRequest.count()).toBe(1);
  });

  it('emails the link, naming the clinic, and keeps only hashes in the database', async () => {
    const token = await signUp();

    const [mail] = emailsTo('ana@example.test');
    expect(mail.subject).toBe('Confirma tu correo para crear Consultorio Torres - MedCita');
    expect(mail.text).toContain('Consultorio Torres');
    expect(mail.text).toContain(`${SIGNUP_TTL_HOURS} horas`);
    const stored = await prisma.signupRequest.findFirst();
    expect(stored).toMatchObject({ tokenHash: hashToken(token), email: 'ana@example.test', clinicName: 'Consultorio Torres' });
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify(stored)).not.toContain('secret123');
    expect(await bcrypt.compare('secret123', stored.passwordHash)).toBe(true);
  });

  it('answers the same whether or not the email already has an account', async () => {
    await createUser({ email: 'known@example.test', name: 'Dr. Conocido' });

    const known = await register({ ...valid, email: 'known@example.test' });
    const unknown = await register({ ...valid, email: 'ghost@example.test' });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
  });

  it('tells the owner of an existing account instead of creating a sign-up', async () => {
    await createUser({ email: 'known@example.test', name: 'Dr. Conocido' });

    await register({ ...valid, email: 'known@example.test' });
    await waitForBackgroundWork();

    const mails = emailsTo('known@example.test');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('Ya tienes una cuenta en MedCita');
    expect(mails[0].text).toContain('/forgot-password');
    expect(mails[0].text).not.toMatch(TOKEN_IN_TEXT);
    expect(await prisma.signupRequest.count()).toBe(0);
  });

  it('normalizes the email and the clinic name', async () => {
    await signUp({ ...valid, email: '  ANA@Example.TEST ', clinicName: '  Consultorio   Torres  ' });

    expect(await prisma.signupRequest.findFirst()).toMatchObject({ email: 'ana@example.test', clinicName: 'Consultorio Torres' });
  });

  it('only the newest link for an email works', async () => {
    const first = await signUp();
    const second = await signUp();

    expect((await verify(first)).status).toBe(400);
    expect((await verify(second)).status).toBe(201);
  });

  it.each([
    ['missing name', { name: '   ' }, 'Name is required'],
    ['name too long', { name: 'x'.repeat(101) }, 'Name must be at most 100 characters'],
    ['invalid email', { email: 'not-an-email' }, 'A valid email is required'],
    ['missing email', { email: undefined }, 'A valid email is required'],
    ['missing clinic name', { clinicName: '  ' }, 'Clinic name must be between 2 and 80 characters'],
    ['one-letter clinic name', { clinicName: 'A' }, 'Clinic name must be between 2 and 80 characters'],
    ['clinic name too long', { clinicName: 'x'.repeat(81) }, 'Clinic name must be between 2 and 80 characters'],
    ['short password', { password: '12345' }, 'Password must be at least 6 characters'],
    ['non-string password', { password: 123456 }, 'Password must be at least 6 characters']
  ])('returns 400 for %s', async (_label, change, message) => {
    const res = await register({ ...valid, ...change });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(await prisma.signupRequest.count()).toBe(0);
    expect(notifications.sent).toHaveLength(0);
  });

  it('limits the requests per email, so nobody can flood an inbox', async () => {
    for (let i = 0; i < LIMITS.registerPerEmail.limit; i++) expect((await register()).status).toBe(202);

    const res = await register();

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/^Too many sign-up requests/);
    expect((await register({ ...valid, email: 'otro@example.test' })).status).toBe(202);
  });

  it('does not count the requests that are rejected for their data: they send no email', async () => {
    for (let i = 0; i < LIMITS.registerPerEmail.limit + 2; i++) {
      expect((await register({ ...valid, password: '123' })).status).toBe(400);
    }

    expect((await register()).status).toBe(202);
  });

  it('limits the requests per IP', async () => {
    for (let i = 0; i < LIMITS.registerPerIp.limit; i++) {
      expect((await register({ ...valid, email: `persona${i}@example.test` })).status).toBe(202);
    }

    expect((await register({ ...valid, email: 'una-mas@example.test' })).status).toBe(429);
  });
});

describe('POST /api/auth/verify-email', () => {
  it('creates the clinic with the chosen name and its admin, and signs the admin in', async () => {
    const token = await signUp();

    const res = await verify(token);

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Dra. Ana Torres',
      email: 'ana@example.test',
      role: 'admin',
      clinic: { id: expect.any(String), name: 'Consultorio Torres' }
    });
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET)).toMatchObject({ id: res.body.user.id, role: 'admin' });
    const clinic = await prisma.clinic.findUnique({ where: { id: res.body.user.clinic.id } });
    expect(clinic).toMatchObject({ name: 'Consultorio Torres', timezone: 'America/Guayaquil', slug: expect.stringMatching(/^consultorio-torres-[0-9a-f]{6}$/) });
    expect(await prisma.signupRequest.count()).toBe(0);
  });

  it('lets the new admin sign in with the password chosen at sign-up, stored hashed', async () => {
    await verify(await signUp());

    const login = await request(app).post('/api/auth/login').send({ email: 'ana@example.test', password: 'secret123' });

    expect(login.status).toBe(200);
    const stored = await prisma.doctor.findUnique({ where: { email: 'ana@example.test' } });
    expect(stored.password).not.toBe('secret123');
  });

  it('gives every sign-up a clinic of its own', async () => {
    const a = await verify(await signUp());
    const b = await verify(await signUp({ ...valid, email: 'otra@example.test', clinicName: 'Consultorio Torres' }));

    expect(a.body.user.clinic.id).not.toBe(b.body.user.clinic.id);
    const me = await request(app).get('/api/patients').set(bearer(b.body.token));
    expect(me.body.total).toBe(0);
  });

  it('works once: the same link is dead the second time', async () => {
    const token = await signUp();

    const first = await verify(token);
    const second = await verify(token);

    expect(first.status).toBe(201);
    expect(second.status).toBe(400);
    expect(second.body.code).toBe(INVALID_LINK_CODE);
    expect(await prisma.doctor.count()).toBe(1);
    expect(await prisma.clinic.count()).toBe(1);
  });

  it('works once even with two simultaneous requests', async () => {
    const token = await signUp();

    const results = await Promise.all([verify(token), verify(token)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.doctor.count()).toBe(1);
    expect(await prisma.clinic.count()).toBe(1);
  });

  it('answers the same 400 for an unknown, malformed, missing or expired link', async () => {
    const expired = newToken();
    await storeRequest(expired, { expiresAt: new Date(Date.now() - 1000) });

    const answers = [];
    for (const token of [newToken(), 'not-a-token', undefined, expired]) answers.push(await verify(token));

    for (const res of answers) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual(answers[0].body);
    }
    expect(answers[0].body.code).toBe(INVALID_LINK_CODE);
    expect(await prisma.signupRequest.count()).toBe(0); // the expired one is cleaned up
    expect(await prisma.clinic.count()).toBe(0);
  });

  it('refuses a link whose email got an account in the meantime, and creates nothing', async () => {
    const token = await signUp();
    await createUser({ email: 'ana@example.test' });

    const res = await verify(token);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(INVALID_LINK_CODE);
    expect(await prisma.doctor.count()).toBe(1);
    expect(await prisma.clinic.count()).toBe(1); // only the test clinic of createUser
  });

  it('limits failed attempts per IP', async () => {
    for (let i = 0; i < LIMITS.accountLinkPerIp.limit; i++) expect((await verify(newToken())).status).toBe(400);

    const res = await verify(newToken());

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/^Too many attempts with an invalid link/);
  });

  it('does not count successful confirmations against the limit', async () => {
    for (let i = 0; i < LIMITS.accountLinkPerIp.limit + 2; i++) {
      const token = newToken();
      await storeRequest(token, { email: `persona${i}@example.test` });
      expect((await verify(token)).status).toBe(201);
    }
  });
});

describe('QA mode (EXPOSE_ACCOUNT_LINKS)', () => {
  afterEach(() => {
    delete process.env.EXPOSE_ACCOUNT_LINKS;
  });

  it('does not put the link in the response by default', async () => {
    const res = await register();
    expect(JSON.stringify(res.body)).not.toMatch(/verify-email|devLink/);
  });

  it('returns the link when asked for, so a script can finish the sign-up', async () => {
    process.env.EXPOSE_ACCOUNT_LINKS = 'true';

    const res = await register();

    expect(res.status).toBe(202);
    const token = res.body.devLink.match(TOKEN_IN_TEXT)[1];
    expect((await verify(token)).status).toBe(201);
  });

  it('lifts the sign-up limits, so a test script can run over and over', async () => {
    process.env.EXPOSE_ACCOUNT_LINKS = 'true';

    for (let i = 0; i < LIMITS.registerPerEmail.limit + 2; i++) expect((await register()).status).toBe(202);
    for (let i = 0; i < LIMITS.accountLinkPerIp.limit + 2; i++) expect((await verify(newToken())).status).toBe(400);
  });

  it('answers the same for an existing account, with no link', async () => {
    process.env.EXPOSE_ACCOUNT_LINKS = 'true';
    await createUser({ email: 'known@example.test' });

    const res = await register({ ...valid, email: 'known@example.test' });

    expect(res.status).toBe(202);
    expect(res.body.devLink).toBeUndefined();
  });

  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['running on Render', { RENDER: 'true' }]
  ])('makes the server refuse to start when %s', (_label, env) => {
    const run = () =>
      execFileSync(process.execPath, ['-e', "require('./src/server')"], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, ...env, EXPOSE_ACCOUNT_LINKS: 'true' },
        stdio: 'pipe'
      });

    expect(run).toThrow(/EXPOSE_ACCOUNT_LINKS=true is only for local QA/);
  });
});
