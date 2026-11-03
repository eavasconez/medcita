const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, bearer } = require('./helpers/factories');
const storage = require('../src/services/fileStorage');
const letterhead = require('../src/services/letterhead');
const pdfLetterhead = require('../src/services/pdfLetterhead');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

// A real 1x1 PNG and a JPG header, as the browser would send them
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
const dataUrl = (buffer, type = 'image/png') => `data:${type};base64,${buffer.toString('base64')}`;

const get = (token, path = '') => request(app).get(`/api/letterhead${path}`).set(bearer(token));
const put = (token, path, body) => request(app).put(`/api/letterhead${path}`).set(bearer(token)).send(body);
const del = (token, path) => request(app).delete(`/api/letterhead${path}`).set(bearer(token));
const audit = () => prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });

// An in-memory bucket in place of the real one
let files;
let saved;
beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, { S3_BUCKET: 'test-bucket', S3_ACCESS_KEY_ID: 'AKIATESTTESTTESTTEST', S3_SECRET_ACCESS_KEY: 'secret-secret-secret-secret-secret-1234' });
  files = new Map();
  jest.spyOn(storage, 'putFile').mockImplementation(async (clinicId, key, body) => { storage.assertOwnKey(clinicId, key); files.set(key, body); });
  jest.spyOn(storage, 'getFile').mockImplementation(async (clinicId, key) => { storage.assertOwnKey(clinicId, key); if (!files.has(key)) throw new Error('missing'); return files.get(key); });
  jest.spyOn(storage, 'deleteFile').mockImplementation(async (clinicId, key) => { storage.assertOwnKey(clinicId, key); files.delete(key); });
  jest.spyOn(storage, 'signedDownloadUrl').mockImplementation(async (clinicId, key) => { storage.assertOwnKey(clinicId, key); return `https://bucket.example.test/${key}?signed=1`; });
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  jest.restoreAllMocks();
});

describe('who may use it', () => {
  it('is for doctors and admins; the secretary gets 403 everywhere and nobody anonymous gets in', async () => {
    const { token: secretary } = await createUser({ role: 'secretary' });
    expect((await get(secretary)).status).toBe(403);
    expect((await put(secretary, '/doctor', { title: 'Dr.' })).status).toBe(403);
    expect((await put(secretary, '/images/signature', { data: dataUrl(PNG) })).status).toBe(403);
    expect((await get(secretary, '/preview')).status).toBe(403);
    expect((await request(app).get('/api/letterhead')).status).toBe(401);
  });

  it('answers 403 at once to a doctor whose account became a secretary after the token was issued', async () => {
    const { user, token } = await createUser({ role: 'doctor' });
    await prisma.doctor.update({ where: { id: user.id }, data: { role: 'secretary' } });
    expect((await get(token)).status).toBe(403);
  });
});

describe('the data of the letterhead', () => {
  it('shows the clinic and the doctor, and says whether the images exist and can be kept', async () => {
    const clinic = await createClinic({ name: 'Clínica Sur', address: 'Av. Principal 123', phone: '022345678', email: 'info@sur.example' });
    const { token } = await createUser({ clinic, name: 'Ana Pérez', specialty: 'Pediatría', title: 'Dra.' });
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      storageConfigured: true,
      canEditClinic: false,
      clinic: { name: 'Clínica Sur', address: 'Av. Principal 123', phone: '022345678', email: 'info@sur.example', hasLogo: false },
      doctor: { name: 'Ana Pérez', specialty: 'Pediatría', title: 'Dra.', licenseNumber: null, hasSignature: false, hasSeal: false }
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Key|password/);
  });

  it('says the storage is not set up when there is no bucket', async () => {
    delete process.env.S3_BUCKET;
    const { token } = await createUser();
    expect((await get(token)).body.storageConfigured).toBe(false);
  });

  it('lets a doctor save their professional data, and clear it with an empty string', async () => {
    const { user, token } = await createUser();
    const res = await put(token, '/doctor', { title: ' Dr. ', licenseNumber: 'MSP 12345', phone: '+593 99 123 4567', contactEmail: 'dr@example.test' });
    expect(res.status).toBe(200);
    expect(res.body.doctor).toMatchObject({ title: 'Dr.', licenseNumber: 'MSP 12345', phone: '+593 99 123 4567', contactEmail: 'dr@example.test' });
    expect(await prisma.doctor.findUnique({ where: { id: user.id } })).toMatchObject({ title: 'Dr.', licenseNumber: 'MSP 12345' });

    await put(token, '/doctor', { licenseNumber: '' });
    expect((await prisma.doctor.findUnique({ where: { id: user.id } })).licenseNumber).toBeNull();
    expect((await prisma.doctor.findUnique({ where: { id: user.id } })).title).toBe('Dr.');
  });

  it('rejects what makes no sense', async () => {
    const { token } = await createUser();
    expect((await put(token, '/doctor', { contactEmail: 'not-an-email' })).status).toBe(400);
    expect((await put(token, '/doctor', { phone: 'call me' })).status).toBe(400);
    expect((await put(token, '/doctor', { licenseNumber: 'x'.repeat(41) })).status).toBe(400);
    expect((await put(token, '/doctor', { title: 5 })).status).toBe(400);
  });

  it('writes the change in the log for a doctor too, without the values', async () => {
    const { user, token } = await createUser({ role: 'doctor' });
    await put(token, '/doctor', { licenseNumber: 'MSP 99999', title: 'Dr.' });
    const [entry] = await audit();
    expect(entry).toMatchObject({ actorId: user.id, actorRole: 'doctor', action: 'update', entity: 'professional_profile', entityId: user.id });
    expect(entry.changes).toEqual({ title: { changed: true }, licenseNumber: { changed: true } });
    expect(JSON.stringify(entry)).not.toContain('MSP 99999');
    // saving the same thing again changes nothing: nothing is logged
    await put(token, '/doctor', { licenseNumber: 'MSP 99999' });
    expect(await audit()).toHaveLength(1);
  });

  it('lets only an admin change the contact data of the clinic', async () => {
    const { token: doctor } = await createUser({ role: 'doctor' });
    expect((await put(doctor, '/clinic', { phone: '022222222' })).status).toBe(403);
    const { token: admin } = await createUser({ role: 'admin' });
    const res = await put(admin, '/clinic', { phone: '022222222', email: 'hola@clinica.example', address: 'Calle 1' });
    expect(res.status).toBe(200);
    expect(res.body.clinic).toMatchObject({ phone: '022222222', email: 'hola@clinica.example', address: 'Calle 1' });
    expect((await put(admin, '/clinic', { email: 'nope' })).status).toBe(400);
  });

  it('keeps each clinic to its own data', async () => {
    const other = await createClinic({ name: 'Otra' });
    const { token: mine } = await createUser({ role: 'admin' });
    const { token: theirs } = await createUser({ role: 'admin', clinic: other });
    await put(mine, '/clinic', { phone: '022111111' });
    expect((await get(theirs)).body.clinic.phone).toBeNull();
  });
});

describe('the images', () => {
  it('keeps a signature in the bucket under the clinic and remembers only its key', async () => {
    const { user, token } = await createUser();
    const res = await put(token, '/images/signature', { data: dataUrl(PNG) });
    expect(res.status).toBe(200);
    const row = await prisma.doctor.findUnique({ where: { id: user.id } });
    expect(row.signatureKey).toMatch(new RegExp(`^clinics/${user.clinicId}/letterhead/signature-${user.id}-\\d+\\.png$`));
    expect(files.get(row.signatureKey).equals(PNG)).toBe(true);
    expect((await get(token)).body.doctor.hasSignature).toBe(true);
    expect(JSON.stringify((await get(token)).body)).not.toContain(row.signatureKey);
  });

  it('accepts a JPG and a bare base64 string', async () => {
    const { user, token } = await createUser();
    expect((await put(token, '/images/seal', { data: JPG.toString('base64') })).status).toBe(200);
    expect((await prisma.doctor.findUnique({ where: { id: user.id } })).sealKey).toMatch(/\.jpg$/);
  });

  it('replaces an image and removes the old file', async () => {
    const { user, token } = await createUser();
    await put(token, '/images/signature', { data: dataUrl(PNG) });
    const first = (await prisma.doctor.findUnique({ where: { id: user.id } })).signatureKey;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await put(token, '/images/signature', { data: dataUrl(JPG, 'image/jpeg') });
    const second = (await prisma.doctor.findUnique({ where: { id: user.id } })).signatureKey;
    expect(second).not.toBe(first);
    expect(files.has(first)).toBe(false);
    expect(files.has(second)).toBe(true);
  });

  it('checks what the file really is, not what it says it is', async () => {
    const { token } = await createUser();
    const gif = Buffer.from('GIF89a' + 'x'.repeat(40));
    for (const data of [dataUrl(gif, 'image/png'), dataUrl(Buffer.from('<?php echo 1; ?>'), 'image/png'), 'not base64 !!', '', 123, undefined]) {
      const res = await put(token, '/images/signature', { data });
      expect(res.status).toBe(400);
    }
    expect(files.size).toBe(0);
  });

  it('refuses an image over 500 KB, and a body far over the limit', async () => {
    const { token } = await createUser();
    const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(letterhead.MAX_IMAGE_BYTES)]);
    const res = await put(token, '/images/signature', { data: dataUrl(big) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/);
    const huge = await put(token, '/images/signature', { data: 'A'.repeat(2 * 1024 * 1024) });
    expect(huge.status).toBe(413);
  });

  it('says so when there is no bucket, and saves nothing', async () => {
    delete process.env.S3_BUCKET;
    const { user, token } = await createUser();
    const res = await put(token, '/images/signature', { data: dataUrl(PNG) });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not set up/);
    expect((await prisma.doctor.findUnique({ where: { id: user.id } })).signatureKey).toBeNull();
  });

  it('knows only logo, signature and seal', async () => {
    const { token } = await createUser();
    expect((await put(token, '/images/stamp', { data: dataUrl(PNG) })).status).toBe(404);
    expect((await get(token, '/images/stamp')).status).toBe(404);
  });

  it('gives the logo to the admin only, and the signature to each doctor for themselves', async () => {
    const { token: doctor } = await createUser({ role: 'doctor' });
    expect((await put(doctor, '/images/logo', { data: dataUrl(PNG) })).status).toBe(403);
    expect((await del(doctor, '/images/logo')).status).toBe(403);

    const { user: admin, token } = await createUser({ role: 'admin' });
    expect((await put(token, '/images/logo', { data: dataUrl(PNG) })).status).toBe(200);
    const clinic = await prisma.clinic.findUnique({ where: { id: admin.clinicId } });
    expect(clinic.logoKey).toMatch(new RegExp(`^clinics/${admin.clinicId}/letterhead/logo-`));
    // every doctor can see the clinic has a logo
    expect((await get(doctor)).body.clinic.hasLogo).toBe(true);
  });

  it('gives a short-lived address to see an image, and 404 when there is none', async () => {
    const { token } = await createUser();
    expect((await get(token, '/images/signature')).status).toBe(404);
    await put(token, '/images/signature', { data: dataUrl(PNG) });
    const res = await get(token, '/images/signature');
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/signed=1$/);
  });

  it('removes an image and its file', async () => {
    const { user, token } = await createUser();
    await put(token, '/images/seal', { data: dataUrl(PNG) });
    const key = (await prisma.doctor.findUnique({ where: { id: user.id } })).sealKey;
    expect((await del(token, '/images/seal')).status).toBe(204);
    expect((await prisma.doctor.findUnique({ where: { id: user.id } })).sealKey).toBeNull();
    expect(files.has(key)).toBe(false);
    expect((await del(token, '/images/seal')).status).toBe(404);
  });

  it('lets an admin remove the signature of a doctor of the clinic, and nobody else', async () => {
    const clinic = await createClinic();
    const { user: doctor, token: doctorToken } = await createUser({ clinic });
    await put(doctorToken, '/images/signature', { data: dataUrl(PNG) });
    expect((await del(doctorToken, `/doctors/${doctor.id}/images/signature`)).status).toBe(403);

    const { token: otherAdmin } = await createUser({ role: 'admin', clinic: await createClinic() });
    expect((await del(otherAdmin, `/doctors/${doctor.id}/images/signature`)).status).toBe(404);
    expect((await prisma.doctor.findUnique({ where: { id: doctor.id } })).signatureKey).not.toBeNull();

    const { token: admin } = await createUser({ role: 'admin', clinic });
    expect((await del(admin, `/doctors/${doctor.id}/images/signature`)).status).toBe(204);
    expect((await prisma.doctor.findUnique({ where: { id: doctor.id } })).signatureKey).toBeNull();
    expect((await del(admin, `/doctors/${doctor.id}/images/logo`)).status).toBe(404);
  });

  it('never shows an image of another clinic', async () => {
    const { token: mine } = await createUser({ role: 'admin' });
    const { token: theirs } = await createUser({ role: 'admin', clinic: await createClinic() });
    await put(theirs, '/images/logo', { data: dataUrl(PNG) });
    expect((await get(mine, '/images/logo')).status).toBe(404);
    expect((await get(mine)).body.clinic.hasLogo).toBe(false);
  });

  it('logs every upload and removal without the image', async () => {
    const { user, token } = await createUser();
    await put(token, '/images/signature', { data: dataUrl(PNG) });
    await del(token, '/images/signature');
    const entries = await audit();
    expect(entries.map((e) => [e.action, e.entity, e.entityId])).toEqual([['create', 'letterhead', user.id], ['delete', 'letterhead', user.id]]);
    expect(entries[0].changes).toEqual({ kind: { to: 'signature' } });
    expect(JSON.stringify(entries)).not.toContain(PNG.toString('base64'));
  });
});

describe('the sample document', () => {
  it('is a PDF, with or without images and with or without data', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {}); // the JPG of the test is only a header: it is skipped, not fatal
    const { token } = await createUser({ role: 'doctor' });
    const bare = await get(token, '/preview').buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(bare.status).toBe(200);
    expect(bare.headers['content-type']).toMatch(/application\/pdf/);
    expect(bare.body.subarray(0, 5).toString()).toBe('%PDF-');

    await put(token, '/images/signature', { data: dataUrl(PNG) });
    await put(token, '/images/seal', { data: dataUrl(JPG, 'image/jpeg') });
    const withImages = await get(token, '/preview').buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(withImages.status).toBe(200);
    expect(withImages.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('still comes out when an image cannot be read from the bucket', async () => {
    const { user, token } = await createUser();
    await prisma.doctor.update({ where: { id: user.id }, data: { signatureKey: `clinics/${user.clinicId}/letterhead/gone.png` } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect((await get(token, '/preview')).status).toBe(200);
  });

  it('is drawn from this doctor and this clinic only', async () => {
    const clinic = await createClinic({ name: 'Clínica Norte' });
    const { user } = await createUser({ clinic, name: 'Luis Mora', title: 'Dr.', licenseNumber: 'MSP 777', specialty: 'Cardiología' });
    await createUser({ name: 'Otro Médico', title: 'Dra.' });
    const lh = await letterhead.loadLetterhead(prisma, clinic.id, user.id);
    const { clinicLines, doctorLines } = pdfLetterhead.headerLines(lh);
    expect(clinicLines[0]).toBe('Clínica Norte');
    expect(doctorLines).toEqual(['Dr. Luis Mora', 'Cardiología', 'Registro profesional: MSP 777']);
    // a doctor of another clinic asked for under this clinic is nobody
    const { user: stranger } = await createUser({ name: 'Otro Médico' });
    const none = await letterhead.loadLetterhead(prisma, clinic.id, stranger.id);
    expect(pdfLetterhead.headerLines(none).doctorLines).toEqual([]);
  });
});

describe('the helpers', () => {
  it('recognises PNG and JPG by their first bytes', () => {
    expect(letterhead.sniffImage(PNG)).toBe('png');
    expect(letterhead.sniffImage(JPG)).toBe('jpg');
    expect(letterhead.sniffImage(Buffer.from('GIF89a......'))).toBeNull();
    expect(letterhead.sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it('collapses spaces and stores empty text as null', () => {
    expect(letterhead.cleanFields({ title: '  Dr.   Ing. ', phone: '' }, ['title', 'phone', 'licenseNumber']).data).toEqual({ title: 'Dr. Ing.', phone: null });
  });
});
