const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { PostgresStore, purgeExpiredCounters } = require('../src/services/rateLimitStore');
const { LIMITS, resetRateLimits, clearLoginAttempts } = require('../src/middleware/rateLimiters');
const { createUser } = require('./helpers/factories');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const storeFor = (prefix = 'test', windowMs = 60 * 1000) => {
  const store = new PostgresStore({ prefix });
  store.init({ windowMs });
  return store;
};
const rows = () => prisma.rateLimitCounter.findMany({ orderBy: { key: 'asc' } });

describe('PostgresStore', () => {
  it('counts the hits of a client inside its window, and says when the window ends', async () => {
    const store = storeFor('test', 60 * 1000);
    const before = Date.now();

    const first = await store.increment('ana@example.test');
    const second = await store.increment('ana@example.test');
    const third = await store.increment('ana@example.test');

    expect([first.totalHits, second.totalHits, third.totalHits]).toEqual([1, 2, 3]);
    expect(first.resetTime).toBeInstanceOf(Date);
    // the window of the first hit is kept by the next ones, and is a minute long
    expect(third.resetTime.getTime()).toBe(first.resetTime.getTime());
    expect(first.resetTime.getTime() - before).toBeGreaterThan(55 * 1000);
    expect(first.resetTime.getTime() - before).toBeLessThan(65 * 1000);
  });

  it('counts every client apart', async () => {
    const store = storeFor();

    await store.increment('uno');
    await store.increment('uno');
    const other = await store.increment('dos');

    expect(other.totalHits).toBe(1);
  });

  it('counts every limiter apart: the same client is not the same count under another prefix', async () => {
    const login = storeFor('login');
    const reset = storeFor('forgot');

    await login.increment('ana@example.test');
    await login.increment('ana@example.test');

    expect((await reset.increment('ana@example.test')).totalHits).toBe(1);
  });

  it('starts over when the window of a client has ended', async () => {
    const store = storeFor('test', 60 * 1000);
    await store.increment('ana');
    await store.increment('ana');
    await prisma.rateLimitCounter.updateMany({ data: { resetAt: new Date(Date.now() - 1000) } });

    const after = await store.increment('ana');

    expect(after.totalHits).toBe(1);
    expect(after.resetTime.getTime()).toBeGreaterThan(Date.now() + 55 * 1000);
  });

  it('does not lose a hit when many requests count at the same moment', async () => {
    const store = storeFor();

    const results = await Promise.all(Array.from({ length: 25 }, () => store.increment('rafaga')));

    expect(results.map((r) => r.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect((await rows())[0].hits).toBe(25);
  });

  it('is shared by every instance of the store: what one counts, the other sees', async () => {
    const instanceA = storeFor('shared');
    const instanceB = storeFor('shared');

    await instanceA.increment('ana');
    await instanceA.increment('ana');

    expect((await instanceB.increment('ana')).totalHits).toBe(3);
  });

  it('takes a hit back, never below zero', async () => {
    const store = storeFor();
    await store.increment('ana');
    await store.increment('ana');

    await store.decrement('ana');
    await store.decrement('ana');
    await store.decrement('ana');

    expect((await rows())[0].hits).toBe(0);
    expect((await store.increment('ana')).totalHits).toBe(1);
  });

  it('forgets one client, or every client of its limiter only', async () => {
    const mine = storeFor('mine');
    const other = storeFor('other');
    await mine.increment('ana');
    await mine.increment('beto');
    await other.increment('ana');

    await mine.resetKey('ana');
    expect((await rows()).length).toBe(2);

    await mine.resetAll();
    const left = await rows();
    expect(left).toHaveLength(1);
    expect(left[0].key.startsWith('other:')).toBe(true);
  });

  it('answers what it knows about a client, and nothing once the window ended', async () => {
    const store = storeFor();
    await store.increment('ana');
    await store.increment('ana');

    expect(await store.get('ana')).toMatchObject({ totalHits: 2 });
    expect(await store.get('nadie')).toBeUndefined();

    await prisma.rateLimitCounter.updateMany({ data: { resetAt: new Date(Date.now() - 1000) } });
    expect(await store.get('ana')).toBeUndefined();
  });

  it('never keeps the email or the IP in the clear', async () => {
    const store = storeFor('login-email');

    await store.increment('ana.paciente@example.test');
    await store.increment('203.0.113.7');

    const keys = (await rows()).map((row) => row.key);
    expect(keys.join(' ')).not.toMatch(/ana|example|203|\.7/);
    expect(keys.every((key) => /^login-email:[0-9a-f]{64}$/.test(key))).toBe(true);
  });
});

describe('purgeExpiredCounters', () => {
  it('removes the counters whose window ended and keeps the live ones', async () => {
    const store = storeFor();
    await store.increment('vivo');
    await store.increment('muerto');
    await prisma.rateLimitCounter.updateMany({ where: { key: store.keyOf('muerto') }, data: { resetAt: new Date(Date.now() - 1000) } });

    const removed = await purgeExpiredCounters();

    expect(removed).toBe(1);
    expect((await rows()).map((row) => row.key)).toEqual([store.keyOf('vivo')]);
  });

  it('has nothing to do on an empty table', async () => {
    expect(await purgeExpiredCounters()).toBe(0);
  });
});

describe('resetRateLimits and clearLoginAttempts', () => {
  it('resetRateLimits forgets everything', async () => {
    await storeFor('a').increment('x');
    await storeFor('b').increment('y');

    await resetRateLimits();

    expect(await rows()).toHaveLength(0);
  });

  it('clearLoginAttempts forgets the failed logins of one email only', async () => {
    const wrong = (email) => request(app).post('/api/auth/login').send({ email, password: 'incorrecta' });
    for (let i = 0; i < 3; i++) await wrong('ana@example.test');
    for (let i = 0; i < 2; i++) await wrong('beto@example.test');
    const countOf = async (email) => (await storeFor('login-email').get(email))?.totalHits;
    expect(await countOf('ana@example.test')).toBe(3);

    await clearLoginAttempts(' Ana@Example.test ');

    expect(await countOf('ana@example.test')).toBeUndefined();
    expect(await countOf('beto@example.test')).toBe(2);
  });
});

describe('the limits survive a restart and are shared by every instance', () => {
  const wrongLogin = (server, email) => request(server).post('/api/auth/login').send({ email, password: 'incorrecta' });

  it('a lockout is still there on a server that just started', async () => {
    await createUser({ email: 'ana@example.test', password: 'correcta1' });
    for (let i = 0; i < LIMITS.loginPerEmail.limit; i++) expect((await wrongLogin(app, 'ana@example.test')).status).toBe(401);
    expect((await wrongLogin(app, 'ana@example.test')).status).toBe(429);

    // another process: its own copy of the app and its limiters, nothing in memory in common
    let restarted;
    let otherPrisma;
    jest.isolateModules(() => {
      restarted = require('../src/server');
      otherPrisma = require('../src/config/prisma');
    });
    try {
      const blocked = await wrongLogin(restarted, 'ana@example.test');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toMatch(/Too many failed login attempts/);
      expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
      // and the right password does not get past it either, until the window ends
      const right = await request(restarted).post('/api/auth/login').send({ email: 'ana@example.test', password: 'correcta1' });
      expect(right.status).toBe(429);
    } finally {
      await otherPrisma.$disconnect();
    }
  });

  it('lets the lockout end when its window does', async () => {
    await createUser({ email: 'ana@example.test', password: 'correcta1' });
    for (let i = 0; i < LIMITS.loginPerEmail.limit; i++) await wrongLogin(app, 'ana@example.test');
    expect((await wrongLogin(app, 'ana@example.test')).status).toBe(429);

    await prisma.rateLimitCounter.updateMany({ data: { resetAt: new Date(Date.now() - 1000) } });

    expect((await request(app).post('/api/auth/login').send({ email: 'ana@example.test', password: 'correcta1' })).status).toBe(200);
  });

  it('still counts only what it was meant to: a good login does not use up an attempt', async () => {
    await createUser({ email: 'ana@example.test', password: 'correcta1' });
    for (let i = 0; i < 3; i++) expect((await request(app).post('/api/auth/login').send({ email: 'ana@example.test', password: 'correcta1' })).status).toBe(200);

    // The attempt is given back right after the answer goes out, so wait for the last one to land
    let hits;
    for (let i = 0; i < 40; i++) {
      hits = (await prisma.rateLimitCounter.findFirst({ where: { key: storeFor('login-email').keyOf('ana@example.test') } }))?.hits ?? 0;
      if (hits === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(hits).toBe(0);
  });

  it('lets a request through when the database cannot count it', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(prisma, '$queryRawUnsafe').mockRejectedValue(new Error('database unreachable'));

    const res = await wrongLogin(app, 'nadie@example.test');

    expect(res.status).toBe(401); // answered by the login itself, not blocked and not a 500
    jest.restoreAllMocks();
  });
});
