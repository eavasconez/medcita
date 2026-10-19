const crypto = require('crypto');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/server');
const { RESET_TOKEN_TTL_MINUTES, hashToken, waitForBackgroundWork } = require('../src/services/passwordResetService');
const { LIMITS } = require('../src/middleware/rateLimiters');
const { prisma, resetDb } = require('./helpers/db');
const { createUser } = require('./helpers/factories');
const { stubNotifications, notificationService } = require('./helpers/notifications');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});

// The endpoint does its work after answering; let it finish before the next
// test wipes the tables.
afterEach(waitForBackgroundWork);

afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

const INVALID_LINK = 'This password reset link is invalid or has expired. Please request a new one.';
const INVALID_LINK_CODE = 'INVALID_RESET_LINK';
const TOKEN_IN_TEXT = /reset-password\?token=([A-Za-z0-9_-]{43})/;

const forgot = (email) => request(app).post('/api/auth/forgot-password').send({ email });
const reset = (token, password) => request(app).post('/api/auth/reset-password').send({ token, password });
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

const resetEmails = () =>
  notifications.sent.filter((m) => m.channel === 'email' && m.subject === 'Restablece tu contraseña - MedCita');
const tokenFrom = (mail) => mail.text.match(TOKEN_IN_TEXT)[1];

// Ask for a link the way a user would and return the token from the email they get.
async function requestLinkFor(email) {
  const res = await forgot(email);
  expect(res.status).toBe(200);
  await waitForBackgroundWork();
  const mails = resetEmails().filter((m) => m.to === email);
  return tokenFrom(mails[mails.length - 1]);
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const storeToken = (doctorId, token, expiresAt = new Date(Date.now() + 60 * 60 * 1000)) =>
  prisma.passwordResetToken.create({ data: { doctorId, tokenHash: hashToken(token), expiresAt } });

describe('POST /api/auth/forgot-password', () => {
  it('answers 200 with the same message whether or not the email has an account', async () => {
    await createUser({ email: 'known@example.test' });

    const known = await forgot('known@example.test');
    const unknown = await forgot('ghost@example.test');

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(known.body.message).toMatch(/^If an account exists for that email/);
  });

  it('emails the reset link to an existing account', async () => {
    await createUser({ email: 'known@example.test', name: 'Dra. Ana Torres' });

    await forgot('known@example.test');
    await waitForBackgroundWork();

    const [mail] = resetEmails();
    const token = tokenFrom(mail);
    expect(resetEmails()).toHaveLength(1);
    expect(mail.to).toBe('known@example.test');
    expect(mail.text).toContain('Dra. Ana Torres');
    expect(mail.text).toContain(`http://localhost:5173/reset-password?token=${token}`);
    expect(mail.text).toContain(`${RESET_TOKEN_TTL_MINUTES} minutos`);
    expect(mail.html).toContain(`href="http://localhost:5173/reset-password?token=${token}"`);
  });

  it('escapes the account name inside the HTML email', async () => {
    await createUser({ email: 'known@example.test', name: '<img src=x onerror=alert(1)>' });

    await forgot('known@example.test');
    await waitForBackgroundWork();

    const [mail] = resetEmails();
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('sends nothing and stores nothing for an unknown account', async () => {
    await forgot('ghost@example.test');
    await waitForBackgroundWork();

    expect(notifications.sent).toHaveLength(0);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it('stores only a hash of the token, valid for about an hour', async () => {
    const { user } = await createUser();

    const token = await requestLinkFor(user.email);

    const rows = await prisma.passwordResetToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ doctorId: user.id, tokenHash: hashToken(token) });
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
    const minutesLeft = (rows[0].expiresAt.getTime() - Date.now()) / 60000;
    expect(minutesLeft).toBeGreaterThan(RESET_TOKEN_TTL_MINUTES - 1);
    expect(minutesLeft).toBeLessThanOrEqual(RESET_TOKEN_TTL_MINUTES);
  });

  it('replaces the previous link when a new one is requested', async () => {
    const { user } = await createUser();

    const first = await requestLinkFor(user.email);
    const second = await requestLinkFor(user.email);

    expect(first).not.toBe(second);
    expect(await prisma.passwordResetToken.count()).toBe(1);
    expect((await reset(first, 'new-password-1')).status).toBe(400);
    expect((await reset(second, 'new-password-2')).status).toBe(200);
  });

  it('links to the first origin when several are configured in FRONTEND_URL', async () => {
    const { user } = await createUser();
    process.env.FRONTEND_URL = 'https://app.example.test/, http://localhost:5173';
    try {
      await forgot(user.email);
      await waitForBackgroundWork();
    } finally {
      process.env.FRONTEND_URL = 'http://localhost:5173';
    }

    expect(resetEmails()[0].text).toContain('https://app.example.test/reset-password?token=');
  });

  it('accepts the email in any case and with surrounding spaces', async () => {
    await createUser({ email: 'known@example.test' });

    await forgot('  KNOWN@Example.TEST ');
    await waitForBackgroundWork();

    expect(resetEmails().map((m) => m.to)).toEqual(['known@example.test']);
  });

  it.each([[undefined], [''], ['not-an-email'], [42]])('returns 400 for the email %p', async (email) => {
    const res = await forgot(email);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A valid email is required');
    expect(notifications.sent).toHaveLength(0);
  });

  it('answers 200 even if the email provider reports a failure', async () => {
    const { user } = await createUser();
    const send = jest.spyOn(notificationService, 'sendEmail').mockResolvedValueOnce(false);

    const res = await forgot(user.email);
    await waitForBackgroundWork();

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
  });

  it('answers 200 even if sending the email throws, and does not log the link', async () => {
    const { user } = await createUser();
    const send = jest.spyOn(notificationService, 'sendEmail').mockRejectedValueOnce(new Error('provider down'));
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await forgot(user.email);
    await waitForBackgroundWork();

    expect(res.status).toBe(200);
    expect(logged).toHaveBeenCalledWith('Password reset request failed:', 'provider down');
    send.mockRestore();
    logged.mockRestore();
  });

  it('answers without waiting for the email to be sent', async () => {
    const { user } = await createUser();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const send = jest.spyOn(notificationService, 'sendEmail').mockImplementation(() => gate.then(() => true));

    // If the endpoint waited for the (stuck) email provider this request would never return.
    const res = await forgot(user.email);

    expect(res.status).toBe(200);
    release();
    await waitForBackgroundWork();
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
  });

  describe('rate limiting', () => {
    const PER_EMAIL = LIMITS.forgotPasswordPerEmail.limit;
    const PER_IP = LIMITS.forgotPasswordPerIp.limit;

    it(`allows ${PER_EMAIL} requests per email per hour and then answers 429`, async () => {
      await createUser({ email: 'known@example.test' });
      for (let i = 0; i < PER_EMAIL; i++) expect((await forgot('known@example.test')).status).toBe(200);

      const blocked = await forgot('known@example.test');
      const another = await forgot('other@example.test');

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toMatch(/^Too many password reset requests\. Please try again in \d+ minutes\.$/);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(another.status).toBe(200);
    });

    it('limits an email that has no account in exactly the same way', async () => {
      for (let i = 0; i < PER_EMAIL; i++) await forgot('ghost@example.test');

      const blocked = await forgot('ghost@example.test');

      expect(blocked.status).toBe(429);
    });

    it(`blocks an IP after ${PER_IP} requests spread over different emails`, async () => {
      for (let i = 0; i < PER_IP; i++) expect((await forgot(`user${i}@example.test`)).status).toBe(200);

      const blocked = await forgot('one-more@example.test');

      expect(blocked.status).toBe(429);
    });
  });
});

describe('POST /api/auth/reset-password', () => {
  it('sets the new password: the old one stops working and the new one logs in', async () => {
    const { user, password } = await createUser({ email: 'known@example.test' });
    const token = await requestLinkFor(user.email);

    const res = await reset(token, 'brand-new-pass');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Password updated successfully' });
    expect((await login(user.email, 'brand-new-pass')).status).toBe(200);
    expect((await login(user.email, password)).status).toBe(401);
  });

  it('stores the new password hashed', async () => {
    const { user } = await createUser();
    const token = await requestLinkFor(user.email);

    await reset(token, 'brand-new-pass');

    const stored = await prisma.doctor.findUnique({ where: { id: user.id } });
    expect(stored.password).not.toBe('brand-new-pass');
    expect(stored.password).toMatch(/^\$2[aby]\$/);
    expect(bcrypt.compareSync('brand-new-pass', stored.password)).toBe(true);
  });

  it('can only be used once', async () => {
    const { user } = await createUser();
    const token = await requestLinkFor(user.email);
    expect((await reset(token, 'first-new-pass')).status).toBe(200);

    const again = await reset(token, 'second-new-pass');

    expect(again.status).toBe(400);
    expect(again.body).toEqual({ error: INVALID_LINK, code: INVALID_LINK_CODE });
    expect((await login(user.email, 'first-new-pass')).status).toBe(200);
    expect((await login(user.email, 'second-new-pass')).status).toBe(401);
  });

  it('rejects an expired link and removes it', async () => {
    const { user, password } = await createUser();
    const token = newToken();
    await storeToken(user.id, token, new Date(Date.now() - 1000));

    const res = await reset(token, 'brand-new-pass');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK, code: INVALID_LINK_CODE });
    expect(await prisma.passwordResetToken.count()).toBe(0);
    expect((await login(user.email, password)).status).toBe(200);
  });

  it.each([
    ['an unknown token', () => newToken()],
    ['a token that is too short', () => 'abc123'],
    ['an empty token', () => ''],
    ['a token with invalid characters', () => '!'.repeat(43)],
    ['a missing token', () => undefined],
    ['a numeric token', () => 123],
    ['an array', () => ['x']],
    ['an object', () => ({ $ne: null })]
  ])('answers the same 400 for %s', async (_label, makeToken) => {
    const res = await reset(makeToken(), 'brand-new-pass');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_LINK, code: INVALID_LINK_CODE });
  });

  it.each([[undefined], [''], ['12345'], [123456]])('rejects the password %p without using up the link', async (password) => {
    const { user } = await createUser();
    const token = await requestLinkFor(user.email);

    const res = await reset(token, password);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Password must be at least 6 characters');
    expect(res.body).not.toHaveProperty('code');
    expect(await prisma.passwordResetToken.count()).toBe(1);
    expect((await reset(token, 'long-enough-pass')).status).toBe(200);
  });

  it('invalidates every other outstanding link of the account', async () => {
    const { user } = await createUser();
    const a = newToken();
    const b = newToken();
    await storeToken(user.id, a);
    await storeToken(user.id, b);

    expect((await reset(a, 'brand-new-pass')).status).toBe(200);

    expect((await reset(b, 'other-new-pass')).status).toBe(400);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it('only changes the account the link belongs to', async () => {
    const target = await createUser();
    const bystander = await createUser();
    const token = await requestLinkFor(target.user.email);

    await reset(token, 'brand-new-pass');

    expect((await login(bystander.user.email, bystander.password)).status).toBe(200);
  });

  it('lets exactly one of two simultaneous requests with the same link succeed', async () => {
    const { user } = await createUser();
    const token = await requestLinkFor(user.email);

    const [a, b] = await Promise.all([reset(token, 'password-one'), reset(token, 'password-two')]);

    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const winner = a.status === 200 ? 'password-one' : 'password-two';
    const stored = await prisma.doctor.findUnique({ where: { id: user.id } });
    expect(bcrypt.compareSync(winner, stored.password)).toBe(true);
  });

  it.each(['admin', 'secretary'])('works for %s accounts too', async (role) => {
    const { user } = await createUser({ role });
    const token = await requestLinkFor(user.email);

    expect((await reset(token, 'brand-new-pass')).status).toBe(200);
    expect((await login(user.email, 'brand-new-pass')).status).toBe(200);
  });

  it('lifts the failed-login lock, so the user can sign in right after resetting', async () => {
    const { user } = await createUser({ email: 'locked@example.test' });
    for (let i = 0; i < LIMITS.loginPerEmail.limit; i++) await login(user.email, 'wrong-password');
    expect((await login(user.email, 'whatever-pass')).status).toBe(429);

    const token = await requestLinkFor(user.email);
    expect((await reset(token, 'brand-new-pass')).status).toBe(200);

    expect((await login(user.email, 'brand-new-pass')).status).toBe(200);
  });

  it('deletes the links of an account that is removed', async () => {
    const { user } = await createUser();
    await storeToken(user.id, newToken());

    await prisma.doctor.delete({ where: { id: user.id } });

    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  describe('rate limiting', () => {
    const LIMIT = LIMITS.resetPasswordPerIp.limit;

    it(`blocks an IP after ${LIMIT} failed attempts, even for a valid link`, async () => {
      const { user } = await createUser();
      const token = await requestLinkFor(user.email);
      for (let i = 0; i < LIMIT; i++) expect((await reset(newToken(), 'brand-new-pass')).status).toBe(400);

      const res = await reset(token, 'brand-new-pass');

      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/^Too many attempts to reset the password\. Please try again in \d+ minutes?\.$/);
    });

    it('does not count successful resets', async () => {
      // Tokens are stored directly: asking for this many links through the endpoint
      // would hit the forgot-password limit instead.
      for (let i = 0; i < LIMIT + 2; i++) {
        const { user } = await createUser();
        const token = newToken();
        await storeToken(user.id, token);
        expect((await reset(token, 'brand-new-pass')).status).toBe(200);
      }
    });
  });
});

describe('secrets in logs', () => {
  it('never writes the reset token to the logs', async () => {
    const { user } = await createUser();
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    const token = await requestLinkFor(user.email);
    await reset(token, 'brand-new-pass');
    await reset(token, 'another-new-pass'); // a failed attempt is logged too, if at all

    const everythingLogged = JSON.stringify([...console.log.mock.calls, ...errors.mock.calls]);
    expect(everythingLogged).not.toContain(token);
    errors.mockRestore();
  });

  it('prints the reset link only when LOG_PASSWORD_RESET_LINKS=true (a dev aid)', async () => {
    const { user } = await createUser();
    process.env.LOG_PASSWORD_RESET_LINKS = 'true';
    let token;
    try {
      token = await requestLinkFor(user.email);
    } finally {
      delete process.env.LOG_PASSWORD_RESET_LINKS;
    }

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`reset-password?token=${token}`));
  });
});
