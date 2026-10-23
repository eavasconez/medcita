const express = require('express');
const prisma = require('../config/prisma');
const { inClinic } = require('../utils/clinicScope');
const { recordClinicalRead, recordClinicalWrite, describeCreated } = require('../services/auditLog');
const vitals = require('../services/vitals');

// Mounted by routes/clinicalBackground.js on /api/patients/:id/clinical/vitals: already behind
// auth, middleware/clinicalAccess.js (doctors and admins) and the lookup of the patient inside the
// caller's clinic (req.patientId). Readings are only added or voided, never edited or deleted
// (see the model in prisma/schema.prisma). Every read leaves an audit entry.
const router = express.Router({ mergeParams: true });

const MAX_READINGS = 500;

const unexpected = (res, err, what) => {
  console.error(`${what} error:`, err);
  res.status(500).json({ error: 'An unexpected error occurred' });
};

// The readings of the patient, newest first, voided ones included (marked), with the BMI worked
// out. `truncated` is true when the patient has more than the newest 500.
router.get('/', async (req, res) => {
  try {
    const rows = await prisma.patientVitals.findMany({
      where: { patientId: req.patientId, clinicId: req.clinicId },
      orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
      take: MAX_READINGS + 1
    });
    await recordClinicalRead(prisma, req, { patientId: req.patientId, section: 'vitals' });
    res.json({ readings: rows.slice(0, MAX_READINGS).map(vitals.withBmi), truncated: rows.length > MAX_READINGS });
  } catch (err) {
    unexpected(res, err, 'List vital signs');
  }
});

router.post('/', async (req, res) => {
  const parsed = vitals.parseVitals(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const { appointmentId } = req.body || {};
  if (appointmentId !== undefined && appointmentId !== null && typeof appointmentId !== 'string') {
    return res.status(400).json({ error: 'appointmentId must be text' });
  }

  try {
    if (appointmentId) {
      const appointment = await prisma.appointment.findFirst({
        where: inClinic(req, { id: appointmentId, patientId: req.patientId }),
        select: { id: true }
      });
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    }

    const reading = await prisma.$transaction(async (tx) => {
      const row = await tx.patientVitals.create({
        data: {
          ...parsed.data,
          appointmentId: appointmentId || null,
          patientId: req.patientId,
          clinicId: req.clinicId,
          recordedById: req.doctorId,
          recordedByName: req.userName
        }
      });
      await recordClinicalWrite(tx, req, { action: 'create', entity: 'patient_vitals', entityId: row.id, changes: describeCreated('patient_vitals', row) });
      return row;
    });
    res.status(201).json(vitals.withBmi(reading));
  } catch (err) {
    unexpected(res, err, 'Record vital signs');
  }
});

// A reading taken by mistake: it stays in the history, marked, and leaves the charts and the
// latest values. Its author or an admin voids it; the reason is optional.
router.post('/:vitalId/void', async (req, res) => {
  const raw = req.body?.reason;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return res.status(400).json({ error: 'reason must be text' });
  const reason = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  if (reason && reason.length > vitals.MAX_VOID_REASON_LENGTH) {
    return res.status(400).json({ error: `reason must be at most ${vitals.MAX_VOID_REASON_LENGTH} characters` });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.patientVitals.findFirst({ where: { id: req.params.vitalId, patientId: req.patientId, clinicId: req.clinicId } });
      if (!row) return { status: 404, error: 'Reading not found' };
      if (row.recordedById !== req.doctorId && req.userRole !== 'admin') return { status: 403, error: 'Only the person who recorded a reading, or an admin, can void it' };
      const { count } = await tx.patientVitals.updateMany({
        where: { id: row.id, voidedAt: null },
        data: { voidedAt: new Date(), voidedById: req.doctorId, voidedByName: req.userName, voidReason: reason }
      });
      if (count === 0) return { status: 409, error: 'This reading is already voided' };
      await recordClinicalWrite(tx, req, {
        action: 'update',
        entity: 'patient_vitals',
        entityId: row.id,
        changes: { patientId: { to: row.patientId }, voided: { from: false, to: true }, ...(reason && { voidReason: { changed: true } }) }
      });
      return { row: await tx.patientVitals.findUnique({ where: { id: row.id } }) };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(vitals.withBmi(result.row));
  } catch (err) {
    unexpected(res, err, 'Void vital signs');
  }
});

module.exports = router;
