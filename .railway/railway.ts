/**
 * Railway settings (docs/DEPLOY.md → Railway): one service that runs the API and serves the built web app, plus its
 * Postgres, in the production environment of the project `medcita-demo`. It deploys the `develop` branch.
 * Railway's switch for automatic deploys is not part of this file: it stays in the dashboard. Neither are the service's
 * generated domain (generate it in Networking, pointing at port 8080) nor the project's own name.
 * Variable values that are secrets or only known later stay in Railway: preserve() keeps each one. Add a new variable
 * here after creating it in Railway, or applying this file removes it.
 * Resources are matched by NAME: the service in Railway must be called `medcita` and the database `postgres`. A
 * service with another name is planned for deletion, so read every line of `railway config plan` before applying.
 * Preview with `railway config plan`, apply with `railway config apply`, from a machine where the Railway CLI is
 * signed in and this folder is linked (`railway link`).
 * When the project moves to Kodffe's Railway account, change the source to `kodffe/medcita`, its branch to `main`,
 * and add the custom domain (medcita.kodffe.com).
 */
import { defineRailway, github, postgres, preserve, project, service } from 'railway/iac';

export default defineRailway((ctx) => {
  if (!ctx.isEnvironment('production')) throw new Error('This file describes the production environment only.');

  const db = postgres('postgres');

  const medcita = service('medcita', {
    source: github('eavasconez/medcita', { branch: 'develop' }),
    // Railpack sets NODE_ENV=production itself, and the build script installs the frontend with --include=dev, so
    // vite and tailwind are there either way. Do not add a NODE_ENV variable: the start script sets it.
    build: { builder: 'RAILPACK', buildCommand: 'npm run build' },
    start: 'npm start',
    // Applies the database migrations before each new version goes live (if one fails, the deploy stops) and then, only
    // because DEMO_SEED is "true" and only while the database is empty, loads the demo data (backend/scripts/seedDemoIfEmpty.js)
    preDeploy: 'npm run migrate',
    healthcheck: '/api/health',
    // One replica, always on: the reminders cron (node-cron) runs inside the process, so a second copy would send
    // everything twice and a sleeping service would miss the hour
    replicas: { 'us-east4-eqdc4a': 1 },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      FRONTEND_URL: preserve(),
      JWT_SECRET: preserve(),
      // Not secrets, so they are written here and the first deploy already starts with them
      PORT: '8080',
      RAILPACK_NODE_VERSION: '22',
      TRUST_PROXY: '1',
      // This is a demo: an empty database gets the demo accounts on the first deploy. Never set it on a real clinic's server
      DEMO_SEED: 'true',
    },
  });

  return project('medcita-demo', { resources: [db, medcita] });
});
