const storage = require('../src/services/fileStorage');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

const CLINIC = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

let saved;
beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, {
    S3_BUCKET: 'medcita-test-files',
    S3_ACCESS_KEY_ID: 'AKIATESTTESTTESTTEST',
    S3_SECRET_ACCESS_KEY: 'secret-secret-secret-secret-secret-1234',
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'https://storage.example.test'
  });
  delete process.env.S3_URL_TTL_SECONDS;
  delete process.env.S3_FORCE_PATH_STYLE;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  jest.restoreAllMocks();
});

describe('configuration', () => {
  it('is configured only with a bucket and both keys', () => {
    expect(storage.isConfigured()).toBe(true);
    for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      const value = process.env[name];
      delete process.env[name];
      expect(storage.isConfigured()).toBe(false);
      process.env[name] = value;
    }
  });

  it('refuses to sign anything when it is not configured', async () => {
    delete process.env.S3_BUCKET;

    await expect(storage.signedDownloadUrl(CLINIC, `clinics/${CLINIC}/a.pdf`)).rejects.toThrow(/not configured/);
  });
});

describe('keys', () => {
  it('builds a key inside the clinic\'s own folder', () => {
    expect(storage.clinicKey(CLINIC, 'patients', 'p-1', 'consent.pdf')).toBe(`clinics/${CLINIC}/patients/p-1/consent.pdf`);
  });

  it.each([[['..', 'x']], [['a/b']], [['']], [['a..b']], [['/etc/passwd']], [['x y']], [[]]])('refuses the key parts %j', (parts) => {
    expect(() => storage.clinicKey(CLINIC, ...parts)).toThrow();
  });

  it('refuses a clinic id that is not a plain name', () => {
    expect(() => storage.clinicKey('../other', 'a.pdf')).toThrow();
    expect(() => storage.clinicKey('', 'a.pdf')).toThrow();
  });

  it('does not accept a key that belongs to another clinic or tries to leave the folder', () => {
    expect(() => storage.assertOwnKey(CLINIC, `clinics/${OTHER}/a.pdf`)).toThrow(/does not belong/);
    expect(() => storage.assertOwnKey(CLINIC, `clinics/${CLINIC}/../${OTHER}/a.pdf`)).toThrow(/does not belong/);
    expect(() => storage.assertOwnKey(CLINIC, `clinics/${CLINIC}x/a.pdf`)).toThrow(/does not belong/);
    expect(() => storage.assertOwnKey(CLINIC, 'a.pdf')).toThrow(/does not belong/);
    expect(() => storage.assertOwnKey(CLINIC, `clinics/${CLINIC}/a.pdf`)).not.toThrow();
  });
});

describe('signed URLs', () => {
  const urlOf = async (promise) => new URL(await promise);

  it('signs a download for the clinic\'s own file, valid 5 minutes by default', async () => {
    const url = await urlOf(storage.signedDownloadUrl(CLINIC, `clinics/${CLINIC}/a.pdf`));

    expect(url.origin).toBe('https://medcita-test-files.storage.example.test');
    expect(url.pathname).toBe(`/clinics/${CLINIC}/a.pdf`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('puts the bucket in the path with S3_FORCE_PATH_STYLE', async () => {
    process.env.S3_FORCE_PATH_STYLE = 'true';

    const url = await urlOf(storage.signedDownloadUrl(CLINIC, `clinics/${CLINIC}/a.pdf`));

    expect(url.origin).toBe('https://storage.example.test');
    expect(url.pathname).toBe(`/medcita-test-files/clinics/${CLINIC}/a.pdf`);
  });

  it('never lasts more than 15 minutes, whatever is asked or configured', async () => {
    process.env.S3_URL_TTL_SECONDS = '86400';
    const configured = await urlOf(storage.signedDownloadUrl(CLINIC, `clinics/${CLINIC}/a.pdf`));
    const asked = await urlOf(storage.signedDownloadUrl(CLINIC, `clinics/${CLINIC}/a.pdf`, { ttl: 3600 }));

    expect(configured.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(asked.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('can ask for a shorter life', async () => {
    const url = await urlOf(storage.signedDownloadUrl(CLINIC, `clinics/${CLINIC}/a.pdf`, { ttl: 60 }));

    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
  });

  it('names the downloaded file safely', async () => {
    const url = await urlOf(storage.signedDownloadUrl(CLINIC, `clinics/${CLINIC}/a.pdf`, { filename: 'Consentimiento "María".pdf\r\nX: y' }));

    expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="Consentimiento _Mar_a_.pdf__X_ y"');
  });

  it('signs an upload tied to its content type', async () => {
    const url = await urlOf(storage.signedUploadUrl(CLINIC, `clinics/${CLINIC}/a.pdf`, { contentType: 'application/pdf' }));

    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
    await expect(storage.signedUploadUrl(CLINIC, `clinics/${CLINIC}/a.pdf`, {})).rejects.toThrow(/contentType/);
  });

  it('refuses to sign for a file of another clinic', async () => {
    await expect(storage.signedDownloadUrl(CLINIC, `clinics/${OTHER}/a.pdf`)).rejects.toThrow(/does not belong/);
    await expect(storage.signedUploadUrl(CLINIC, `clinics/${OTHER}/a.pdf`, { contentType: 'text/plain' })).rejects.toThrow(/does not belong/);
    await expect(storage.deleteFile(CLINIC, `clinics/${OTHER}/a.pdf`)).rejects.toThrow(/does not belong/);
  });
});

// A bucket in memory, to run the check without a network
function fakeBucket({ publicRead = false, breakUpload = false } = {}) {
  const files = new Map();
  const fetchImpl = async (url, options = {}) => {
    const { pathname, searchParams } = new URL(url);
    const signed = searchParams.has('X-Amz-Signature');
    const method = options.method || 'GET';
    if (method === 'PUT') {
      if (!signed || breakUpload) return { ok: false, status: 403, text: async () => '' };
      files.set(pathname, options.body);
      return { ok: true, status: 200, text: async () => '' };
    }
    if (!signed && !publicRead) return { ok: false, status: 403, text: async () => '' };
    return files.has(pathname)
      ? { ok: true, status: 200, text: async () => files.get(pathname) }
      : { ok: false, status: 404, text: async () => '' };
  };
  return { files, fetchImpl };
}

describe('checkStorage', () => {
  beforeEach(() => {
    jest.spyOn(require('@aws-sdk/client-s3').S3Client.prototype, 'send').mockImplementation(async () => ({}));
  });

  it('passes on a private bucket that works, and removes the test file', async () => {
    const { fetchImpl } = fakeBucket();

    const checks = await storage.checkStorage({ fetchImpl });

    expect(checks.map((c) => [c.name, c.ok])).toEqual([
      ['upload with a signed URL', true],
      ['read it back with a signed URL', true],
      ['the same address without the signature is refused', true],
      ['remove the test file', true]
    ]);
    const send = require('@aws-sdk/client-s3').S3Client.prototype.send;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('fails when anyone can read the file without a signature (a public bucket)', async () => {
    const { fetchImpl } = fakeBucket({ publicRead: true });

    const checks = await storage.checkStorage({ fetchImpl });

    expect(checks.find((c) => c.name.includes('without the signature'))).toMatchObject({ ok: false, detail: 'HTTP 200' });
  });

  it('reports a failed upload and still tries to clean up', async () => {
    const { fetchImpl } = fakeBucket({ breakUpload: true });

    const checks = await storage.checkStorage({ fetchImpl });

    expect(checks[0]).toMatchObject({ name: 'upload with a signed URL', ok: false, detail: 'HTTP 403' });
    expect(checks.at(-1)).toMatchObject({ name: 'remove the test file' });
  });

  it('reports a network error instead of throwing', async () => {
    const checks = await storage.checkStorage({ fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });

    expect(checks[0]).toMatchObject({ name: 'talk to the bucket', ok: false, detail: 'getaddrinfo ENOTFOUND' });
  });
});
