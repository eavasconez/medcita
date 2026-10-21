const { checkSeedTarget } = require('../src/utils/seedGuard');

describe('checkSeedTarget', () => {
  it.each([
    'postgresql://postgres:x@localhost:5432/medcita?schema=public',
    'postgresql://postgres:x@127.0.0.1:5433/postman?schema=public',
    'postgresql://postgres:x@postgres:5432/medcita'
  ])('lets the seed run against a local database: %s', (url) => {
    expect(checkSeedTarget(url, {}).ok).toBe(true);
  });

  it('refuses a remote database, naming its host and how to confirm it', () => {
    const result = checkSeedTarget('postgresql://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require', {});

    expect(result.ok).toBe(false);
    expect(result.host).toBe('ep-cool-name-123456.us-east-2.aws.neon.tech');
    expect(result.message).toContain('SEED_REMOTE_HOST=ep-cool-name-123456.us-east-2.aws.neon.tech');
  });

  it('accepts a remote database only when its exact host is confirmed', () => {
    const url = 'postgresql://u:p@ep-staging-1.us-east-2.aws.neon.tech/neondb';

    expect(checkSeedTarget(url, { SEED_REMOTE_HOST: 'ep-staging-1.us-east-2.aws.neon.tech' }).ok).toBe(true);
    expect(checkSeedTarget(url, { SEED_REMOTE_HOST: 'ep-production-9.us-east-2.aws.neon.tech' }).ok).toBe(false);
    expect(checkSeedTarget(url, { SEED_REMOTE_HOST: 'true' }).ok).toBe(false);
  });

  it('refuses a missing or malformed connection string', () => {
    expect(checkSeedTarget(undefined, {}).ok).toBe(false);
    expect(checkSeedTarget('not a url', {}).ok).toBe(false);
  });
});
