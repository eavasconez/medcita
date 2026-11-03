/**
 * Railway settings (docs/DEPLOY.md → Railway): one service that runs the API and serves the built web app, plus its
 * Postgres, in the production environment of the project `medcita-demo`. It deploys the `develop` branch.
 * Railway's switch for automatic deploys is not part of this file: it stays in the dashboard.
 * Variable values stay in Railway: preserve() keeps each one. Add a new variable here as preserve() after creating
 * it in Railway, or applying this file removes it.
 * Preview with `railway config plan`, apply with `railway config apply`, from a machine where the Railway CLI is
 * signed in and this folder is linked (`railway link --project medcita-demo`).
 * When the project moves to Kodffe's Railway account, change the source to `kodffe/medcita`, its branch to `main`,
 * and add the custom domain (medcita.kodffe.com) next to the service domain.
 */
import { defineRailway, github, postgres, preserve, project, service } from 'railway/iac';

export default defineRailway((ctx) => {
  if (!ctx.isEnvironment('production')) throw new Error('This file describes the production environment only.');

  const db = postgres('postgres');

  const medcita = service('medcita-demo', {
    source: github('eavasconez/medcita', { branch: 'develop' }),
    // No NODE_ENV variable: set while building, it would leave out the dev dependencies (vite, tailwind) the build
    // needs. The start script (package.json) sets it.
    build: { builder: 'RAILPACK', buildCommand: 'npm run build' },
    start: 'npm start',
    // Applies the database migrations before each new version goes live; if one fails, the deploy stops
    preDeploy: 'npm run migrate',
    healthcheck: '/api/health',
    // One replica, always on: the reminders cron (node-cron) runs inside the process, so a second copy would send
    // everything twice and a sleeping service would miss the hour
    replicas: { 'us-east4-eqdc4a': 1 },
    networking: {
      serviceDomains: {
        'medcita-demo.up.railway.app': { port: 8080 },
      },
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      FRONTEND_URL: preserve(),
      JWT_SECRET: preserve(),
      RAILPACK_NODE_VERSION: preserve(),
      TRUST_PROXY: preserve(),
    },
  });

  return project('medcita-demo', { resources: [db, medcita] });
});
