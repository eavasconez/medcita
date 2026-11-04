const { main: seedDemo } = require('../scripts/seedDemoIfEmpty');
const { checkSeedTarget } = require('../src/utils/seedGuard');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser } = require('./helpers/factories');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const REMOTE = 'postgresql://postgres:secret@postgres.railway.internal:5432/railway';

const run = async (env, deps = {}) => {
  const lines = [];
  const runSeed = jest.fn();
  const code = await seedDemo(env, (line) => lines.push(line), { prisma, runSeed, ...deps });
  return { code, lines, runSeed };
};

describe('npm run seed:demo', () => {
  it('loads the demo data into an empty database when DEMO_SEED is "true"', async () => {
    const { code, lines, runSeed } = await run({ DEMO_SEED: 'true', DATABASE_URL: REMOTE });

    expect(code).toBe(0);
    expect(runSeed).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(['The database at postgres.railway.internal is empty and DEMO_SEED is "true": loading the demo data.']);
  });

  it('gives the seed the host of the database, which the seed requires for a remote one', async () => {
    const { runSeed } = await run({ DEMO_SEED: 'true', DATABASE_URL: REMOTE });

    const seedEnv = runSeed.mock.calls[0][0];
    expect(seedEnv.SEED_REMOTE_HOST).toBe('postgres.railway.internal');
    // without it the seed would refuse this database, with it the seed lets it through
    expect(checkSeedTarget(REMOTE, {}).ok).toBe(false);
    expect(checkSeedTarget(REMOTE, seedEnv).ok).toBe(true);
  });

  it.each([[undefined], ['false'], ['1'], ['TRUE'], ['yes'], ['']])('does nothing when DEMO_SEED is %p, and does not even look at the database', async (value) => {
    const db = { clinic: { count: jest.fn() }, doctor: { count: jest.fn() }, patient: { count: jest.fn() }, $disconnect: jest.fn() };
    const env = { DATABASE_URL: REMOTE };
    if (value !== undefined) env.DEMO_SEED = value;

    const { code, lines, runSeed } = await run(env, { prisma: db });

    expect(code).toBe(0);
    expect(runSeed).not.toHaveBeenCalled();
    expect(db.clinic.count).not.toHaveBeenCalled();
    expect(lines).toEqual(['DEMO_SEED is not "true": the demo data is not loaded.']);
  });

  it('never touches a database that already has data, and says what it found', async () => {
    const clinic = await createClinic({ name: 'Consultorio Torres' });
    await createUser({ role: 'admin', clinic });

    const { code, lines, runSeed } = await run({ DEMO_SEED: 'true', DATABASE_URL: REMOTE });

    expect(code).toBe(0);
    expect(runSeed).not.toHaveBeenCalled();
    expect(lines[0]).toMatch(/already has data \(1 clinics, 1 users, 0 patients\): the demo data is not loaded again\./);
  });

  it.each([
    ['a clinic', [1, 0, 0]],
    ['a user', [0, 1, 0]],
    ['a patient', [0, 0, 1]]
  ])('counts a database with only %s as having data', async (_name, [clinics, doctors, patients]) => {
    const db = {
      clinic: { count: jest.fn().mockResolvedValue(clinics) },
      doctor: { count: jest.fn().mockResolvedValue(doctors) },
      patient: { count: jest.fn().mockResolvedValue(patients) },
      $disconnect: jest.fn()
    };

    const { code, runSeed } = await run({ DEMO_SEED: 'true', DATABASE_URL: REMOTE }, { prisma: db });

    expect(code).toBe(0);
    expect(runSeed).not.toHaveBeenCalled();
  });

  it('is run again on every deploy without harm: the second time there is data and it leaves it alone', async () => {
    const first = await run({ DEMO_SEED: 'true', DATABASE_URL: REMOTE });
    expect(first.runSeed).toHaveBeenCalledTimes(1);

    // what the seed would have left behind
    await createUser({ role: 'admin' });

    const second = await run({ DEMO_SEED: 'true', DATABASE_URL: REMOTE });
    expect(second.runSeed).not.toHaveBeenCalled();
  });

  it('fails when DATABASE_URL is missing or is not a URL, without loading anything', async () => {
    const missing = await run({ DEMO_SEED: 'true' });
    const broken = await run({ DEMO_SEED: 'true', DATABASE_URL: 'not a url' });

    expect(missing.code).toBe(1);
    expect(broken.code).toBe(1);
    expect(missing.runSeed).not.toHaveBeenCalled();
    expect(broken.runSeed).not.toHaveBeenCalled();
    expect(missing.lines).toEqual(['DATABASE_URL is missing or is not a URL.']);
  });

  it('lets the error of the seed through, so the deploy fails instead of leaving an empty demo', async () => {
    const runSeed = jest.fn(() => {
      throw new Error('seed failed');
    });

    await expect(seedDemo({ DEMO_SEED: 'true', DATABASE_URL: REMOTE }, () => {}, { prisma, runSeed })).rejects.toThrow('seed failed');
  });
});
