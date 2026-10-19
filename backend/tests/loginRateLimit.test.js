const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser } = require('./helpers/factories');
const { LIMITS } = require('../src/middleware/rateLimiters');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const PER_EMAIL = LIMITS.loginPerEmail.limit;
const PER_IP = LIMITS.loginPerIp.limit;

const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const failLogin = (email) => login(email, 'wrong-password');

async function failTimes(email, times) {
  for (let i = 0; i < times; i++) {
    const res = await failLogin(email);
    expect(res.status).toBe(401);
  }
}

describe('login rate limiting per account', () => {
  it(`blocks the account after ${PER_EMAIL} failed attempts, even with the right password`, async () => {
    const { user, password } = await createUser({ email: 'victim@example.test' });
    await failTimes(user.email, PER_EMAIL);

    const res = await login(user.email, password);

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/^Too many failed login attempts\. Please try again in \d+ minutes?\.$/);
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.retryAfterSeconds).toBeLessThanOrEqual(LIMITS.loginPerEmail.windowMs / 1000);
    expect(res.body).not.toHaveProperty('token');
  });

  it('tells the client how long to wait through the Retry-After header', async () => {
    const { user, password } = await createUser();
    await failTimes(user.email, PER_EMAIL);

    const res = await login(user.email, password);

    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['ratelimit-limit']).toBeDefined();
  });

  it('lets the account attempt again while it is still below the limit', async () => {
    const { user, password } = await createUser();
    await failTimes(user.email, PER_EMAIL - 1);

    const res = await login(user.email, password);

    expect(res.status).toBe(200);
  });

  it('counts the email case-insensitively and ignoring surrounding spaces', async () => {
    const { user, password } = await createUser({ email: 'victim@example.test' });
    await failLogin('VICTIM@example.test');
    await failLogin('  victim@EXAMPLE.test ');
    await failLogin('victim@example.test');
    await failLogin('Victim@Example.Test');
    await failLogin(' victim@example.test');

    const res = await login(user.email, password);

    expect(res.status).toBe(429);
  });

  it("does not block other accounts that share the same IP", async () => {
    const victim = await createUser();
    const other = await createUser();
    await failTimes(victim.user.email, PER_EMAIL);

    const otherWrong = await failLogin(other.user.email);
    const otherRight = await login(other.user.email, other.password);

    expect(otherWrong.status).toBe(401);
    expect(otherRight.status).toBe(200);
  });

  it('answers unknown accounts exactly like existing ones, so the limit leaks nothing', async () => {
    const real = await createUser({ email: 'real@example.test' });
    await failTimes(real.user.email, PER_EMAIL);
    await failTimes('ghost@example.test', PER_EMAIL);

    const realBlocked = await login('real@example.test', real.password);
    const ghostBlocked = await login('ghost@example.test', 'whatever1');

    expect(realBlocked.status).toBe(429);
    expect(ghostBlocked.status).toBe(429);
    expect(ghostBlocked.body.error).toBe(realBlocked.body.error);
  });
});

describe('what does not count towards the limit', () => {
  it('does not count successful logins', async () => {
    const { user, password } = await createUser();

    for (let i = 0; i < PER_IP + 5; i++) {
      const res = await login(user.email, password);
      expect(res.status).toBe(200);
    }
  });

  it('does not count malformed requests (400), only wrong credentials (401)', async () => {
    const { user, password } = await createUser();

    for (let i = 0; i < PER_EMAIL * 3; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: user.email });
      expect(res.status).toBe(400);
    }
    const res = await login(user.email, password);

    expect(res.status).toBe(200);
  });
});

describe('login rate limiting per IP', () => {
  const makeUsers = (n) => Promise.all(Array.from({ length: n }, () => createUser()));

  it(`blocks an IP after ${PER_IP} failed attempts spread over different accounts`, async () => {
    const users = await makeUsers(PER_IP + 1);
    for (const { user } of users.slice(0, PER_IP)) {
      const res = await failLogin(user.email);
      expect(res.status).toBe(401);
    }

    // A brand-new account and even a correct password: the IP is already blocked.
    const last = users[PER_IP];
    const res = await login(last.user.email, last.password);

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/^Too many failed login attempts/);
  });

  it('cannot be dodged by sending a different X-Forwarded-For on every request', async () => {
    const users = await makeUsers(PER_IP + 1);
    for (const [i, { user }] of users.slice(0, PER_IP).entries()) {
      const res = await failLogin(user.email).set('X-Forwarded-For', `203.0.113.${i + 1}`);
      expect(res.status).toBe(401);
    }

    const last = users[PER_IP];
    const res = await login(last.user.email, last.password).set('X-Forwarded-For', '198.51.100.99');

    expect(res.status).toBe(429);
  });
});

describe('login rate limiting behind trusted proxies', () => {
  beforeEach(() => app.set('trust proxy', 2));
  afterEach(() => app.set('trust proxy', false));

  it('limits each real client separately when the proxy count is configured', async () => {
    const users = await Promise.all(Array.from({ length: PER_IP + 1 }, () => createUser()));
    // Client A (first address) reaches the app through two proxies (the second hop).
    const asClientA = (req) => req.set('X-Forwarded-For', '192.0.2.10, 10.0.0.1');
    const asClientB = (req) => req.set('X-Forwarded-For', '192.0.2.20, 10.0.0.1');

    for (const { user } of users.slice(0, PER_IP)) {
      expect((await asClientA(failLogin(user.email))).status).toBe(401);
    }

    const last = users[PER_IP];
    const blockedA = await asClientA(login(last.user.email, last.password));
    const allowedB = await asClientB(login(last.user.email, last.password));

    expect(blockedA.status).toBe(429);
    expect(allowedB.status).toBe(200);
  });
});
