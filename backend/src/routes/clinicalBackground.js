const express = require('express');
const prisma = require('../config/prisma');
const { inClinic } = require('../utils/clinicScope');
const {
  recordClinicalRead, recordClinicalWrite, diffFields, describeCreated, describeRemoved
} = require('../services/auditLog');
const consultationNotes = require('./consultationNotes');
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
