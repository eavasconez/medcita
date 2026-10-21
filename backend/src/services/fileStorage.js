const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Private storage for the files the clinical record will need (documents, signed
// consents, images). Render's disk is wiped on every deploy, so files live in a
// bucket of any S3-compatible provider (AWS S3, Cloudflare R2, Backblaze B2, MinIO…).
//
// The bucket is private: nobody reads or writes it directly. The app hands out
// short-lived signed URLs, and only after checking the person may see that clinic's
// files. Every key starts with `clinics/<clinicId>/`, so a URL can never be signed for
// another clinic's file. Nothing in the app uploads a file yet (S8-06 only prepares
// this); `npm run storage:check` proves the bucket works and is really private.
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 900;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const settings = () => ({
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  // Custom endpoints (MinIO, some providers) want bucket-in-path URLs
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
});

const isConfigured = () => {
  const { bucket, accessKeyId, secretAccessKey } = settings();
  return Boolean(bucket && accessKeyId && secretAccessKey);
};

let cached;
function client() {
  if (!isConfigured()) throw new Error('File storage is not configured (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)');
  const { region, endpoint, accessKeyId, secretAccessKey, forcePathStyle } = settings();
  const signature = [region, endpoint, accessKeyId, secretAccessKey, forcePathStyle].join('|');
  if (!cached || cached.signature !== signature) {
    cached = {
      signature,
      s3: new S3Client({ region, endpoint, forcePathStyle, credentials: { accessKeyId, secretAccessKey } })
    };
  }
  return cached.s3;
}

// How long a signed URL lasts: 5 minutes by default, never more than 15
function ttlSeconds(requested) {
  const fromEnv = parseInt(process.env.S3_URL_TTL_SECONDS, 10);
  const wanted = requested ?? (Number.isNaN(fromEnv) ? DEFAULT_TTL_SECONDS : fromEnv);
  return Math.min(Math.max(Math.floor(wanted) || DEFAULT_TTL_SECONDS, 1), MAX_TTL_SECONDS);
}

// The key of a clinic's file: clinics/<clinicId>/<part>/<part>… Each part is a plain
// name (letters, digits, dot, dash, underscore), so no part can climb out with `..`
// or add a slash.
function clinicKey(clinicId, ...parts) {
  if (!clinicId || !SEGMENT.test(clinicId)) throw new Error('A valid clinicId is required');
  if (parts.length === 0) throw new Error('A file name is required');
  for (const part of parts) {
    if (typeof part !== 'string' || !SEGMENT.test(part) || part.includes('..')) throw new Error(`Invalid file key part: ${JSON.stringify(part)}`);
  }
  return ['clinics', clinicId, ...parts].join('/');
}

// A key may only be used for the clinic it belongs to
function assertOwnKey(clinicId, key) {
  const prefix = `clinics/${clinicId}/`;
  if (typeof key !== 'string' || !clinicId || !key.startsWith(prefix) || key.slice(prefix.length).split('/').some((part) => !SEGMENT.test(part) || part.includes('..'))) {
    throw new Error('That file does not belong to this clinic');
  }
}

// URL to read one file, valid for a few minutes. `filename` makes the browser
// download it under that name.
async function signedDownloadUrl(clinicId, key, { ttl, filename } = {}) {
  assertOwnKey(clinicId, key);
  const command = new GetObjectCommand({
    Bucket: settings().bucket,
    Key: key,
    ...(filename && { ResponseContentDisposition: `attachment; filename="${String(filename).replace(/[^\w.\- ]/g, '_')}"` })
  });
  return getSignedUrl(client(), command, { expiresIn: ttlSeconds(ttl) });
}

// URL to upload one file with PUT, valid for a few minutes. The content type is part
// of the signature: the upload must send exactly that one.
async function signedUploadUrl(clinicId, key, { contentType, ttl } = {}) {
  assertOwnKey(clinicId, key);
  if (!contentType) throw new Error('contentType is required');
  const command = new PutObjectCommand({ Bucket: settings().bucket, Key: key, ContentType: contentType });
  return getSignedUrl(client(), command, { expiresIn: ttlSeconds(ttl), signableHeaders: new Set(['content-type']) });
}

async function deleteFile(clinicId, key) {
  assertOwnKey(clinicId, key);
  return client().send(new DeleteObjectCommand({ Bucket: settings().bucket, Key: key }));
}

// Proves the bucket works end to end and is private, with a throwaway file that is
// always removed: upload through a signed URL, read it back through another, and check
// that the same address without the signature is refused. Returns the list of checks.
async function checkStorage({ fetchImpl = fetch } = {}) {
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, ...(detail && { detail }) });
  const key = `_storage-check/${crypto.randomUUID()}.txt`;
  const body = `medcita storage check ${new Date().toISOString()}`;
  const send = (command) => client().send(command);
  const bucket = settings().bucket;

  try {
    const putUrl = await getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'text/plain' }), {
      expiresIn: 60,
      signableHeaders: new Set(['content-type'])
    });
    const put = await fetchImpl(putUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body });
    record('upload with a signed URL', put.ok, put.ok ? undefined : `HTTP ${put.status}`);

    const getUrl = await getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
    const read = await fetchImpl(getUrl);
    record('read it back with a signed URL', read.ok && (await read.text()) === body, read.ok ? undefined : `HTTP ${read.status}`);

    const unsigned = await fetchImpl(getUrl.split('?')[0]);
    record('the same address without the signature is refused', unsigned.status === 401 || unsigned.status === 403, `HTTP ${unsigned.status}`);
  } catch (err) {
    record('talk to the bucket', false, err.message);
  } finally {
    try {
      await send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      record('remove the test file', true);
    } catch (err) {
      record('remove the test file', false, err.message);
    }
  }
  return checks;
}

module.exports = { isConfigured, clinicKey, assertOwnKey, signedDownloadUrl, signedUploadUrl, deleteFile, checkStorage, ttlSeconds, MAX_TTL_SECONDS, DEFAULT_TTL_SECONDS };
