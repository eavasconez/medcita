const request = require('supertest');
const app = require('../src/server');
const { resolveTrustProxy, RENDER_PROXY_HOPS } = require('../src/config/trustProxy');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, bearer } = require('./helpers/factories');

describe('resolveTrustProxy', () => {
  it('trusts no proxy by default', () => {
    expect(resolveTrustProxy({})).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: '' })).toBe(false);
  });

  it('assumes the Cloudflare + Render load balancers chain on Render (3 hops since Oct 2026)', () => {
    expect(RENDER_PROXY_HOPS).toBe(3);
    expect(resolveTrustProxy({ RENDER: 'true' })).toBe(3);
  });

  it.each([
    ['1', 1],
    ['2', 2],
    ['3', 3],
    ['false', false],
    ['0', false]
  ])('accepts TRUST_PROXY=%s', (value, expected) => {
    expect(resolveTrustProxy({ TRUST_PROXY: value })).toBe(expected);
  });

  it('lets TRUST_PROXY override the Render default', () => {
    expect(resolveTrustProxy({ RENDER: 'true', TRUST_PROXY: '1' })).toBe(1);
    expect(resolveTrustProxy({ RENDER: 'true', TRUST_PROXY: 'false' })).toBe(false);
  });

  it.each(['true', 'yes', '-1', '2.5', '100', 'loopback', ' 2'])('rejects TRUST_PROXY=%s', (value) => {
    expect(() => resolveTrustProxy({ TRUST_PROXY: value })).toThrow(/Invalid TRUST_PROXY/);
  });

  it('explains why "true" is refused', () => {
    expect(() => resolveTrustProxy({ TRUST_PROXY: 'true' })).toThrow(/spoof/);
  });
});

describe('GET /api/admin/client-ip', () => {
  beforeEach(resetDb);
  afterEach(() => app.set('trust proxy', false));
  afterAll(() => prisma.$disconnect());

  it('is only available to admins', async () => {
    const doctor = await createUser();

    const anonymous = await request(app).get('/api/admin/client-ip');
    const asDoctor = await request(app).get('/api/admin/client-ip').set(bearer(doctor.token));

    expect(anonymous.status).toBe(401);
    expect(asDoctor.status).toBe(403);
  });

  it('reports the connection address and ignores X-Forwarded-For when no proxy is trusted', async () => {
    const admin = await createUser({ role: 'admin' });

    const res = await request(app)
      .get('/api/admin/client-ip')
      .set(bearer(admin.token))
      .set('X-Forwarded-For', '203.0.113.7');

    expect(res.status).toBe(200);
    expect(res.body.trustProxy).toBe(false);
    expect(res.body.ip).not.toBe('203.0.113.7');
    expect(res.body.forwardedFor).toBe('203.0.113.7');
  });

  it('reports the real client when the proxy count is configured, ignoring spoofed entries', async () => {
    app.set('trust proxy', 2);
    const admin = await createUser({ role: 'admin' });

    // "spoofed" is what the client claimed; the two trusted proxies appended the rest.
    const res = await request(app)
      .get('/api/admin/client-ip')
      .set(bearer(admin.token))
      .set('X-Forwarded-For', '6.6.6.6, 198.51.100.23, 172.70.1.1');

    expect(res.body.trustProxy).toBe(2);
    expect(res.body.ip).toBe('198.51.100.23');
  });
  it('reads the real client through the chain Render showed on 22 Oct 2026 (client, Cloudflare, Render internal)', async () => {
    app.set('trust proxy', RENDER_PROXY_HOPS);
    const admin = await createUser({ role: 'admin' });

    // 157.100.137.15 is the client; the app's own socket is the third proxy (the load balancer)
    const res = await request(app)
      .get('/api/admin/client-ip')
      .set(bearer(admin.token))
      .set('X-Forwarded-For', '157.100.137.15, 104.23.213.169, 10.26.16.133');

    expect(res.body.trustProxy).toBe(3);
    expect(res.body.ip).toBe('157.100.137.15');

    // with the old value of 2 the app saw Cloudflare instead
    app.set('trust proxy', 2);
    const before = await request(app).get('/api/admin/client-ip').set(bearer(admin.token)).set('X-Forwarded-For', '157.100.137.15, 104.23.213.169, 10.26.16.133');
    expect(before.body.ip).toBe('104.23.213.169');
  });
});
