// Where the app is hosted, read from the variables each platform sets on every service it runs.
// Render sets RENDER=true and RENDER_SERVICE_NAME / RENDER_GIT_COMMIT; Railway sets
// RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_NAME and RAILWAY_SERVICE_NAME, plus RAILWAY_GIT_COMMIT_SHA
// on deploys that come from GitHub.
const onRender = (env = process.env) => Boolean(env.RENDER);
const onRailway = (env = process.env) => Boolean(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_NAME);

// A platform that runs the service for us, as opposed to a developer's machine
const isHosted = (env = process.env) => onRender(env) || onRailway(env);

const serviceName = (env = process.env) => env.RENDER_SERVICE_NAME || env.RAILWAY_SERVICE_NAME || 'local';
const serviceVersion = (env = process.env) => env.RENDER_GIT_COMMIT || env.RAILWAY_GIT_COMMIT_SHA || null;

module.exports = { onRender, onRailway, isHosted, serviceName, serviceVersion };
