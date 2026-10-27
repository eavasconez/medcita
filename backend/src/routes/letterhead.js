const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const clinicalAccess = require('../middleware/clinicalAccess');
const storage = require('../services/fileStorage');
const letterhead = require('../services/letterhead');
const pdfLetterhead = require('../services/pdfLetterhead');
const { recordClinicalWrite, diffFields } = require('../services/auditLog');
const { inClinic } = require('../utils/clinicScope');

// The letterhead of the documents (S11-01): what the doctor prints under their name and what the
// clinic prints at the top. Doctors and admins only (the secretary issues no documents). The
// logo is the clinic's, so the admin manages it; the signature and the seal are each doctor's own.
// The images travel through the API (JSON, base64, at most 500 KB) so the server checks what
// they are before keeping them in the private bucket; they are never public.
router.use(clinicalAccess);

const NOT_CONFIGURED = { error: 'File storage is not set up yet. Ask whoever manages MedCita to configure it.' };
const isAdmin = (req) => req.userRole === 'admin';
const kindOf = (req) => letterhead.IMAGE_KINDS[req.params.kind];

async function currentState(req) {
  const [clinic, doctor] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: req.clinicId } }),
    prisma.doctor.findFirst({ where: inClinic(req, { id: req.doctorId }) })
  ]);
  return { clinic, doctor };
}

// What the screen shows: text data, which images exist and whether they can be kept
router.get('/', async (req, res) => {
  try {
    const { clinic, doctor } = await currentState(req);
    res.json({ ...letterhead.present(clinic, doctor), canEditClinic: isAdmin(req) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// The doctor's own data for their documents
router.put('/doctor', async (req, res) => {
  const { data, error } = letterhead.cleanFields(req.body || {}, ['title', 'licenseNumber', 'phone', 'contactEmail']);
  if (error) return res.status(400).json({ error });
  try {
    const before = await prisma.doctor.findFirst({ where: inClinic(req, { id: req.doctorId }) });
    const after = await prisma.doctor.update({ where: { id: req.doctorId }, data });
    const changes = diffFields('professional_profile', before, after);
    if (changes) await recordClinicalWrite(prisma, req, { action: 'update', entity: 'professional_profile', entityId: req.doctorId, changes });
    res.json(letterhead.present(await prisma.clinic.findUnique({ where: { id: req.clinicId } }), after));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// The clinic's contact data for the letterhead (admin). The name has its own screen.
router.put('/clinic', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Only an admin can change the clinic letterhead' });
  const { data, error } = letterhead.cleanFields(req.body || {}, ['address', 'phone', 'email']);
  if (error) return res.status(400).json({ error });
  try {
    const before = await prisma.clinic.findUnique({ where: { id: req.clinicId } });
    const after = await prisma.clinic.update({ where: { id: req.clinicId }, data });
    const changes = diffFields('letterhead', before, after);
    if (changes) await recordClinicalWrite(prisma, req, { action: 'update', entity: 'letterhead', entityId: req.clinicId, changes });
    const { doctor } = await currentState(req);
    res.json(letterhead.present(after, doctor));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Who owns the image of this kind for this request: the clinic (logo, admin) or the doctor (their own)
async function ownerOf(req, res) {
  const kind = kindOf(req);
  if (!kind) {
    res.status(404).json({ error: 'Unknown image' });
    return null;
  }
  if (kind.owner === 'clinic' && !isAdmin(req)) {
    res.status(403).json({ error: 'Only an admin can change the clinic logo' });
    return null;
  }
  return kind;
}

const ownerRow = async (req, kind) => (kind.owner === 'clinic'
  ? prisma.clinic.findUnique({ where: { id: req.clinicId } })
  : prisma.doctor.findFirst({ where: inClinic(req, { id: req.doctorId }) }));

async function updateOwner(req, kind, key) {
  return kind.owner === 'clinic'
    ? prisma.clinic.update({ where: { id: req.clinicId }, data: { [kind.column]: key } })
    : prisma.doctor.update({ where: { id: req.doctorId }, data: { [kind.column]: key } });
}

const ownerId = (req, kind) => (kind.owner === 'clinic' ? req.clinicId : req.doctorId);

// Upload or replace an image: { data: <base64 or data URL> }
router.put('/images/:kind', async (req, res) => {
  const kind = await ownerOf(req, res);
  if (!kind) return;
  if (!storage.isConfigured()) return res.status(409).json(NOT_CONFIGURED);
  const image = letterhead.parseImage(req.body?.data);
  if (image.error) return res.status(400).json({ error: image.error });
  try {
    const row = await ownerRow(req, kind);
    const key = letterhead.imageKey(req.clinicId, req.params.kind, ownerId(req, kind), image.ext);
    await storage.putFile(req.clinicId, key, image.buffer, image.contentType);
    await updateOwner(req, kind, key);
    if (row[kind.column]) await storage.deleteFile(req.clinicId, row[kind.column]).catch((err) => console.error('Old letterhead image not removed:', err.message));
    await recordClinicalWrite(prisma, req, { action: row[kind.column] ? 'update' : 'create', entity: 'letterhead', entityId: ownerId(req, kind), changes: { kind: { to: req.params.kind } } });
    res.json({ kind: req.params.kind, saved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'We could not save the image' });
  }
});

// Short-lived address to see an image (never public)
router.get('/images/:kind', async (req, res) => {
  const kind = kindOf(req);
  if (!kind) return res.status(404).json({ error: 'Unknown image' });
  if (!storage.isConfigured()) return res.status(409).json(NOT_CONFIGURED);
  try {
    const row = await ownerRow(req, kind);
    const key = row?.[kind.column];
    if (!key) return res.status(404).json({ error: 'No image uploaded' });
    res.json({ url: await storage.signedDownloadUrl(req.clinicId, key) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'We could not read the image' });
  }
});

async function removeImage(req, res, kind, row, ownerKey) {
  const key = row[kind.column];
  if (!key) return res.status(404).json({ error: 'No image uploaded' });
  try {
    await (kind.owner === 'clinic'
      ? prisma.clinic.update({ where: { id: req.clinicId }, data: { [kind.column]: null } })
      : prisma.doctor.update({ where: { id: ownerKey }, data: { [kind.column]: null } }));
    if (storage.isConfigured()) await storage.deleteFile(req.clinicId, key).catch((err) => console.error('Letterhead image not removed:', err.message));
    await recordClinicalWrite(prisma, req, { action: 'delete', entity: 'letterhead', entityId: ownerKey, changes: { kind: { from: req.params.kind } } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
}

router.delete('/images/:kind', async (req, res) => {
  const kind = await ownerOf(req, res);
  if (!kind) return;
  const row = await ownerRow(req, kind);
  return removeImage(req, res, kind, row, ownerId(req, kind));
});

// An admin removes the signature or the seal of a doctor of their clinic (someone who left, a wrong one)
router.delete('/doctors/:id/images/:kind', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Only an admin can remove the image of another doctor' });
  const kind = kindOf(req);
  if (!kind || kind.owner !== 'doctor') return res.status(404).json({ error: 'Unknown image' });
  const doctor = await prisma.doctor.findFirst({ where: inClinic(req, { id: req.params.id }) });
  if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
  return removeImage(req, res, kind, doctor, doctor.id);
});

// A sample page with the letterhead as it will look on the documents
router.get('/preview', async (req, res) => {
  try {
    const lh = await letterhead.loadLetterhead(prisma, req.clinicId, req.doctorId);
    const clinic = await prisma.clinic.findUnique({ where: { id: req.clinicId }, select: { timezone: true } });
    const pdf = await pdfLetterhead.renderPreview(lh, { timezone: clinic.timezone });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="letterhead-preview.pdf"', 'Cache-Control': 'no-store' });
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'We could not build the preview' });
  }
});

module.exports = router;
