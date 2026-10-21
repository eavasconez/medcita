// Checks the private file bucket: `npm run storage:check`. Uses the S3_* variables of
// backend/.env (or of the environment) and leaves nothing behind.
require('dotenv').config();
const storage = require('../src/services/fileStorage');

(async () => {
  if (!storage.isConfigured()) {
    console.error('File storage is not configured: set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (see docs/DEPLOY.md, "Archivos privados").');
    process.exit(1);
  }
  const checks = await storage.checkStorage();
  for (const check of checks) console.log(`${check.ok ? 'OK  ' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
  process.exit(checks.every((check) => check.ok) ? 0 : 1);
})();
