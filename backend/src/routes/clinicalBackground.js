const express = require('express');
const prisma = require('../config/prisma');
const { inClinic } = require('../utils/clinicScope');
const {
  recordClinicalRead, recordClinicalWrite, diffFields, describeCreated, describeRemoved
} = require('../services/auditLog');
const consultationNotes = require('./consultationNotes');
const vitalSigns = require('./vitals');
const timeline = require('../services/patientTimeline');
const { KINDS, MAX_ITEMS_PER_PATIENT, parseItem, byImportance } = require('../services/clinicalBackground');

// Mounted by routes/patients.js on /api/patients/:id/clinical, behind auth and
// middleware/clinicalAccess.js: only doctors and admins get here (the secretary gets 403
// before any of this runs). Every route looks the patient up inside the caller's clinic
// first, so another clinic's patient is a 404, and every read leaves an audit entry.
const router = express.Router({ mergeParams: true });

const unexpected = (res, err, what) => {
  console.error(`${what} error:`, err);
  res.status(500).json({ error: 'An unexpected error occurred' });
};

router.use(async (req, res, next) => {
  try {
    const patient = await prisma.patient.findFirst({ where: inClinic(req, { id: req.params.id }), select: { id: true } });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    req.patientId = patient.id;
    next();
  } catch (err) {
    unexpected(res, err, 'Clinical patient lookup');
  }
});

// The SOAP notes of the patient's appointments (S10-04)
router.use('/notes', consultationNotes);
// Vital signs (S10-06)
router.use('/vitals', vitalSigns);

// The patient's story, newest first: visits, notes with their diagnoses, addenda, vital signs and
// consent events (S10-07). `types` (comma separated) narrows it, `before` pages it. The text of
// the notes is not in it. One audit entry per call.
router.get('/timeline', async (req, res) => {
  const limit = req.query.limit === undefined ? timeline.DEFAULT_LIMIT : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > timeline.MAX_LIMIT) {
    return res.status(400).json({ error: `limit must be a whole number between 1 and ${timeline.MAX_LIMIT}` });
  }
  let before = null;
  if (req.query.before !== undefined) {
    before = new Date(req.query.before);
    if (typeof req.query.before !== 'string' || Number.isNaN(before.getTime())) return res.status(400).json({ error: 'before must be a date (ISO 8601)' });
  }
  let types = timeline.TYPES;
  if (req.query.types !== undefined) {
    types = typeof req.query.types === 'string' ? req.query.types.split(',').map((t) => t.trim()).filter(Boolean) : [];
    if (types.length === 0 || types.some((t) => !timeline.TYPES.includes(t))) {
      return res.status(400).json({ error: `types must be a comma separated list of: ${timeline.TYPES.join(', ')}` });
    }
  }

  try {
    const page = await timeline.buildTimeline(prisma, req, req.patientId, { limit, before, types });
    await recordClinicalRead(prisma, req, { patientId: req.patientId, section: 'timeline' });
    res.json({ events: page.events, nextBefore: page.nextBefore ? page.nextBefore.toISOString() : null });
  } catch (err) {
    unexpected(res, err, 'Patient timeline');
  }
});

const listOf = (kind, patientId, clinicId) =>
  prisma[KINDS[kind].model].findMany({ where: { patientId, clinicId }, orderBy: { createdAt: 'asc' } });

const sorted = (kind, rows) => (kind === 'backgrounds' ? rows : [...rows].sort(byImportance));

// Allergies, regular medication and history in one call: what the record screen shows and
// what a doctor looks at before prescribing. One audit entry for the whole read.
router.get('/summary', async (req, res) => {
  try {
    const [allergies, medications, backgrounds] = await Promise.all(
      ['allergies', 'medications', 'backgrounds'].map((kind) => listOf(kind, req.patientId, req.clinicId))
    );
    await recordClinicalRead(prisma, req, { patientId: req.patientId, section: 'summary' });
    res.json({ allergies: sorted('allergies', allergies), medications: sorted('medications', medications), backgrounds });
  } catch (err) {
    unexpected(res, err, 'Clinical summary');
  }
});

for (const kind of Object.keys(KINDS)) {
  const { model, entity } = KINDS[kind];

  router.get(`/${kind}`, async (req, res) => {
    try {
      const rows = await listOf(kind, req.patientId, req.clinicId);
      await recordClinicalRead(prisma, req, { patientId: req.patientId, section: kind });
      res.json(sorted(kind, rows));
    } catch (err) {
      unexpected(res, err, `List ${kind}`);
    }
  });

  router.post(`/${kind}`, async (req, res) => {
    const parsed = parseItem(kind, req.body, { creating: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    try {
      const created = await prisma.$transaction(async (tx) => {
        const count = await tx[model].count({ where: { patientId: req.patientId, clinicId: req.clinicId } });
        if (count >= MAX_ITEMS_PER_PATIENT) return null;
        const row = await tx[model].create({
          data: {
            ...parsed.data,
            patientId: req.patientId,
            clinicId: req.clinicId,
            recordedById: req.doctorId,
            recordedByName: req.userName
          }
        });
        await recordClinicalWrite(tx, req, {
          action: 'create',
          entity,
          entityId: row.id,
          changes: describeCreated(entity, row)
        });
        return row;
      });
      if (!created) return res.status(409).json({ error: `A patient can have at most ${MAX_ITEMS_PER_PATIENT} entries of this kind` });
      res.status(201).json(created);
    } catch (err) {
      unexpected(res, err, `Create ${kind}`);
    }
  });

  router.put(`/${kind}/:itemId`, async (req, res) => {
    const parsed = parseItem(kind, req.body, { creating: false });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const previous = await tx[model].findFirst({ where: { id: req.params.itemId, patientId: req.patientId, clinicId: req.clinicId } });
        if (!previous) return null;
        const row = await tx[model].update({ where: { id: previous.id }, data: parsed.data });
        const changes = diffFields(entity, previous, row);
        if (changes) {
          await recordClinicalWrite(tx, req, {
            action: 'update',
            entity,
            entityId: row.id,
            changes: { patientId: { to: row.patientId }, ...changes }
          });
        }
        return row;
      });
      if (!updated) return res.status(404).json({ error: 'Entry not found' });
      res.json(updated);
    } catch (err) {
      unexpected(res, err, `Update ${kind}`);
    }
  });

  // For an entry written by mistake. What stopped being true (a resolved allergy, a medicine
  // that was stopped) is kept with `active: false` instead: it is part of the history.
  router.delete(`/${kind}/:itemId`, async (req, res) => {
    try {
      const removed = await prisma.$transaction(async (tx) => {
        const row = await tx[model].findFirst({ where: { id: req.params.itemId, patientId: req.patientId, clinicId: req.clinicId } });
        if (!row) return false;
        await tx[model].delete({ where: { id: row.id } });
        await recordClinicalWrite(tx, req, { action: 'delete', entity, entityId: row.id, changes: describeRemoved(entity, row) });
        return true;
      });
      if (!removed) return res.status(404).json({ error: 'Entry not found' });
      res.json({ message: 'Entry deleted successfully' });
    } catch (err) {
      unexpected(res, err, `Delete ${kind}`);
    }
  });
}

module.exports = router;
