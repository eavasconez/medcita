// Serves the built web app (frontend/dist) from the same process as the API, so the site and /api
// share one address: one service to host, no CORS between them and nothing to point the frontend at.
// It is a no-op when the app was not built (local development runs Vite on its own), so the API
// answers exactly as before there.
const fs = require('fs');
const path = require('path');
const express = require('express');

const DEFAULT_DIST = path.join(__dirname, '..', '..', '..', 'frontend', 'dist');
const YEAR = 365 * 24 * 60 * 60;

function webApp({ dist = process.env.WEB_DIST || DEFAULT_DIST } = {}) {
  const router = express.Router();
  const indexFile = path.join(dist, 'index.html');
  if (!fs.existsSync(indexFile)) return router;

  router.use(
    express.static(dist, {
      // Vite names everything in /assets after its content, so those files never change under the same
      // name and can be kept for a year. The pages themselves are always asked for again.
      setHeaders: (res, file) => {
        const hashed = file.startsWith(path.join(dist, 'assets') + path.sep);
        res.setHeader('Cache-Control', hashed ? `public, max-age=${YEAR}, immutable` : 'no-cache');
      }
    })
  );

  // Any other page address belongs to the app's router (React): give it the app and let it decide. The API
  // and anything that is not a plain page request keep their own answers (404 included).
  router.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/')) return next();
    // A path with a file extension that was not found is a missing file, not a page of the app
    if (path.extname(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  return router;
}

module.exports = { webApp, DEFAULT_DIST };
