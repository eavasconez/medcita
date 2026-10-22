const { main: resetLimits } = require('../scripts/resetRateLimits');
const { main: sendTestAlert } = require('../scripts/sendTestAlert');
const { prisma, resetDb } = require('./helpers/db');
const emailService = require('../src/services/emailService');

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const output = () => {
  const lines = [];
  return { lines, out: (line) => lines.push(line) };
};
const count = () => prisma.rateLimitCounter.count();
const seedCounters = () =>
  prisma.rateLimitCounter.createMany({ data: [{ key: 'login-ip:a', hits: 3, resetAt: new Date(Date.now() + 60000) }, { key: 'login-email:b', hits: 5, resetAt: new Date(Date.now() + 60000) }] });

describe('npm run limits:reset', () => {
  it('clears every counter of a local database and says how many', async () => {
    await seedCounters();
    const { lines, out } = output();

    const code = await resetLimits({ DATABASE_URL: 'postgresql://postgres:x@localhost:5432/medcita_test' }, out);

    expect(code).toBe(0);
    expect(lines).toEqual(['Cleared 2 rate limit counters on localhost.']);
    expect(await count()).toBe(0);
  });

  it('says "1 counter" and is fine with nothing to clear', async () => {
    await prisma.rateLimitCounter.create({ data: { key: 'k', hits: 1, resetAt: new Date(Date.now() + 60000) } });
    const first = output();
    const second = output();

    await resetLimits({ DATABASE_URL: 'postgresql://postgres:x@127.0.0.1:5432/db' }, first.out);
    await resetLimits({ DATABASE_URL: 'postgresql://postgres:x@127.0.0.1:5432/db' }, second.out);

    expect(first.lines[0]).toBe('Cleared 1 rate limit counter on 127.0.0.1.');
    expect(second.lines[0]).toBe('Cleared 0 rate limit counters on 127.0.0.1.');
  });

  it('refuses a database that is not local, and clears nothing, unless the host is named', async () => {
    await seedCounters();
    const refused = output();
    const wrongHost = output();

    const a = await resetLimits({ DATABASE_URL: 'postgresql://u:p@ep-cool-123.us-east-2.aws.neon.tech/neondb' }, refused.out);
    const b = await resetLimits({ DATABASE_URL: 'postgresql://u:p@ep-cool-123.us-east-2.aws.neon.tech/neondb', RATE_LIMIT_RESET_HOST: 'otro.host' }, wrongHost.out);

    expect([a, b]).toEqual([1, 1]);
    expect(refused.lines[0]).toContain('ep-cool-123.us-east-2.aws.neon.tech, which is not a local database');
    expect(refused.lines[0]).toContain('RATE_LIMIT_RESET_HOST=ep-cool-123.us-east-2.aws.neon.tech npm run limits:reset');
    expect(await count()).toBe(2);
  });

  it('says so when there is no DATABASE_URL', async () => {
    const { lines, out } = output();

    expect(await resetLimits({}, out)).toBe(1);
    expect(lines[0]).toMatch(/DATABASE_URL is missing/);
  });
});

describe('npm run alerts:test', () => {
  it('sends one sample alert to every address and says how each went', async () => {
    jest.spyOn(emailService, 'deliverEmail').mockResolvedValue({ ok: true, provider: 'brevo' });
    const { lines, out } = output();

    const code = await sendTestAlert({ ERROR_ALERT_EMAILS: 'ops@example.test,dev@example.test' }, out);

    expect(code).toBe(0);
    expect(lines).toEqual(['OK -> ops@example.test (brevo)', 'OK -> dev@example.test (brevo)']);
    expect(emailService.deliverEmail.mock.calls[0][1]).toBe('[MedCita] Error 500 en GET /api/alerts-test');
  });

  it('says when nothing was really sent because no email provider is configured', async () => {
    jest.spyOn(emailService, 'deliverEmail').mockResolvedValue({ ok: true, provider: 'mock', simulated: true });
    const { lines, out } = output();

    expect(await sendTestAlert({ ERROR_ALERT_EMAILS: 'ops@example.test' }, out)).toBe(0);
    expect(lines[0]).toContain('simulated: no email provider is configured');
  });

  it('fails, with the reason, when the email could not be sent', async () => {
    jest.spyOn(emailService, 'deliverEmail').mockResolvedValue({ ok: false, provider: 'brevo', error: 'Brevo answered 401' });
    const { lines, out } = output();

    expect(await sendTestAlert({ ERROR_ALERT_EMAILS: 'ops@example.test' }, out)).toBe(1);
    expect(lines[0]).toBe('FAILED -> ops@example.test (brevo): Brevo answered 401');
  });

  it('asks for the addresses when there are none', async () => {
    jest.spyOn(emailService, 'deliverEmail');
    const { lines, out } = output();

    expect(await sendTestAlert({ ERROR_ALERT_EMAILS: ' , nonsense' }, out)).toBe(1);
    expect(lines[0]).toMatch(/ERROR_ALERT_EMAILS has no valid address/);
    expect(emailService.deliverEmail).not.toHaveBeenCalled();
  });
});
