const { onRender, onRailway, isHosted, serviceName, serviceVersion } = require('../src/config/hosting');

describe('hosting', () => {
  it('is not hosted on a developer machine', () => {
    expect(isHosted({})).toBe(false);
    expect(serviceName({})).toBe('local');
    expect(serviceVersion({})).toBeNull();
  });

  it('knows Render from RENDER', () => {
    expect(onRender({ RENDER: 'true' })).toBe(true);
    expect(onRailway({ RENDER: 'true' })).toBe(false);
    expect(isHosted({ RENDER: 'true' })).toBe(true);
  });

  it.each([{ RAILWAY_PROJECT_ID: 'abc' }, { RAILWAY_ENVIRONMENT_NAME: 'production' }])('knows Railway from %o', (env) => {
    expect(onRailway(env)).toBe(true);
    expect(onRender(env)).toBe(false);
    expect(isHosted(env)).toBe(true);
  });

  it('reads the service name and version of each platform', () => {
    expect(serviceName({ RENDER_SERVICE_NAME: 'medcita-backend' })).toBe('medcita-backend');
    expect(serviceName({ RAILWAY_SERVICE_NAME: 'medcita-demo' })).toBe('medcita-demo');
    expect(serviceVersion({ RENDER_GIT_COMMIT: 'abc' })).toBe('abc');
    expect(serviceVersion({ RAILWAY_GIT_COMMIT_SHA: 'def' })).toBe('def');
  });
});
