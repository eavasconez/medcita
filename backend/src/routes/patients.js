const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const { parsePagination, pageInfo } = require('../utils/pagination');
const { upsertPatient } = require('../services/patientUpsert');
const { recordAudit, recordRead, diffFields, auditPatientUpsert } = require('../services/auditLog');
const consents = require('../services/patientConsent');
const { consentDocumentFor, CONSENT_METHODS, CURRENT_CONSENT_VERSION } = require('../legal/healthDataConsent');
const { inClinic } = require('../utils/clinicScope');
const clinicalAccess = require('../middleware/clinicalAccess');
const { clinicalRoleOf } = clinicalAccess;
const clinicalBackground = require('./clinicalBackground');
const { buildPatientExport } = require('../services/patientExport');
const { renderPatientExportPdf } = require('../services/patientExportPdf');
const { parseProfile, withDerived } = require('../services/patientRecord');
const { clinicDateString } = require('../utils/clinicTime');
const { parseListQuery, buildWhere, buildOrderBy, sortByName } = require('../services/patientList');

const todayOf = (req) => clinicDateString(new Date(), req.clinicTimezone);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// All patient routes are protected
router.use(auth);

// Get the clinic's patients, paginated so a growing patient list doesn't return every row on every
// load. ?search looks in name, phone and cedula; ?consent (none, granted, outdated, withdrawn) and
// ?minor (true, false) filter; ?sort (name, cedula, phone, age, createdAt) and ?order (asc, desc)
// order it (newest first by default). A value outside those lists is a 400. The order always ends
// in the id, so the pages of a list never repeat or skip a patient (services/patientList.js).
router.get('/', async (req, res) => {
  const paging = parsePagination(req.query, { defaultPageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE });
  if (paging.error) return res.status(400).json({ error: paging.error });
  const { page, pageSize, skip } = paging;

  const params = parseListQuery(req.query);
  if (params.error) return res.status(400).json({ error: params.error });

  try {
    const consentIds = params.consent ? await consents.standingFilter(req.clinicId, params.consent) : null;
    const where = inClinic(req, buildWhere(params, { today: todayOf(req), consentIds }));

    const include = { _count: { select: { appointments: { where: { status: { not: 'cancelled' } } } } } };
    let patients;
    let total;
    if (params.sort === 'name') {
      // Ordered by sortByName: first the ids and names of everyone that matches, then the rows of the page
      const matching = sortByName(await prisma.patient.findMany({ where, select: { id: true, name: true } }), params.order);
      total = matching.length;
      const pageIds = matching.slice(skip, skip + pageSize).map((r) => r.id);
      const rows = await prisma.patient.findMany({ where: { id: { in: pageIds }, clinicId: req.clinicId }, include });
      const byId = new Map(rows.map((r) => [r.id, r]));
      patients = pageIds.map((id) => byId.get(id)).filter(Boolean);
    } else {
      [patients, total] = await Promise.all([
        prisma.patient.findMany({ where, include, orderBy: buildOrderBy(params), skip, take: pageSize }),
        prisma.patient.count({ where })
      ]);
    }
    const standing = await consents.statusByPatient(req.clinicId, patients.map((p) => p.id));
    res.json({
      patients: patients.map((p) => ({ ...withDerived(p, todayOf(req)), consent: standing[p.id] })),
      ...pageInfo({ total, page, pageSize })
    });
  } catch (err) {
    console.error('List patients error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// The text of the health-data consent in force, with the clinic's name filled in. What the
// patient is shown is exactly this, and what gets recorded is its version.
router.get('/consent-document', async (req, res) => {
  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: req.clinicId }, select: { name: true } });
    res.json({ ...consentDocumentFor(clinic?.name), methods: CONSENT_METHODS });
  } catch (err) {
    console.error('Consent document error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Where a patient stands on the health-data consent, and every event so far.
router.get('/:id/consents', async (req, res) => {
  try {
    const patient = await prisma.patient.findFirst({ where: inClinic(req, { id: req.params.id }), select: { id: true } });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json({ currentVersion: CURRENT_CONSENT_VERSION, ...(await consents.history(req.clinicId, patient.id)) });
  } catch (err) {
    console.error('Patient consents error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Records that the patient gave their consent, or took it back. Staff of the clinic
// register it; the version is always the text in force, and `documentVersion` (if sent)
// has to match it, so a text that changed while the form was open is not signed blind.
router.post('/:id/consents', async (req, res) => {
  const { granted, method, documentVersion } = req.body;
  if (typeof granted !== 'boolean') {
    return res.status(400).json({ error: 'granted must be true (consent given) or false (consent withdrawn)' });
  }
  if (!CONSENT_METHODS.includes(method)) {
    return res.status(400).json({ error: `method must be one of: ${CONSENT_METHODS.join(', ')}` });
  }
  if (documentVersion !== undefined && documentVersion !== CURRENT_CONSENT_VERSION) {
    return res.status(409).json({ error: 'The consent text has changed. Reload it and ask the patient again.' });
  }

  try {
    const patient = await prisma.patient.findFirst({ where: inClinic(req, { id: req.params.id }), select: { id: true } });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    await consents.recordConsent(req, patient.id, { granted, method });
    res.status(201).json({ currentVersion: CURRENT_CONSENT_VERSION, ...(await consents.history(req.clinicId, patient.id)) });
  } catch (err) {
    console.error('Record consent error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Everything MedCita holds about one patient, as a file: the answer to a patient who asks
// for their data (access and portability). Admin only, because it is the whole record, and
// every export is written to the audit log. As JSON by default, or as a PDF to read and hand
// over (?format=pdf, S10-07). See services/patientExport.js for what it holds.
router.get('/:id/export', async (req, res) => {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Only an administrator can export a patient\'s data' });
  const format = req.query.format === undefined ? 'json' : req.query.format;
  if (format !== 'json' && format !== 'pdf') return res.status(400).json({ error: 'format must be json or pdf' });

  try {
    const data = await buildPatientExport(prisma, req, req.params.id);
    if (!data) return res.status(404).json({ error: 'Patient not found' });

    await recordRead(prisma, req, { entity: 'patient_export', entityId: data.patient.id, changes: { format: { to: format } } });

    if (format === 'pdf') {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="patient-${data.patient.id}.pdf"`);
      renderPatientExportPdf(data, { exportedBy: req.userName, timezone: req.clinicTimezone }, res);
      return;
    }
    res.set('Content-Disposition', `attachment; filename="patient-${data.patient.id}.json"`);
    res.json(data);
  } catch (err) {
    console.error('Export patient error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Allergies, regular medication and history (S10-03): clinical data, doctors and admins only
router.use('/:id/clinical', clinicalAccess, clinicalBackground);

// The patient's record in one place: their data, how old they are and their appointments.
// The notes of an appointment are booking notes (administrative, visible to the whole front
// desk); what is clinical is written in the consultation note (S10-04), which has its own
// routes and rules. `canViewClinical` tells the screen whether to ask for the clinical parts.
router.get('/:id', async (req, res) => {
  try {
    const patient = await prisma.patient.findFirst({
      where: inClinic(req, { id: req.params.id }),
      include: {
        appointments: {
          orderBy: [{ date: 'desc' }, { time: 'desc' }],
          include: {
            doctor: { select: { id: true, name: true } },
            type: { select: { name: true, color: true } }
          }
        }
      }
    });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const clinical = Boolean(await clinicalRoleOf(req));
    const { appointments, ...fields } = patient;
    const standing = await consents.statusByPatient(req.clinicId, [patient.id]);

    res.json({
      patient: { ...withDerived(fields, todayOf(req)), consent: standing[patient.id] },
      appointments: appointments.map((a) => ({
        id: a.id,
        date: a.date,
        time: a.time,
        status: a.status,
        durationMinutes: a.durationMinutes,
        doctor: a.doctor,
        type: a.type,
        notes: a.notes
      })),
      canViewClinical: clinical
    });
  } catch (err) {
    console.error('Get patient error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Create new patient
router.post('/', async (req, res) => {
  const { name, phone, email, cedula } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
  // Empty string means "not provided" here, not a value to store - cedula is
  // @unique, so leaving it as "" collides with the next cedula-less patient.
  const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim() : null;
  const normalizedCedula = typeof cedula === 'string' && cedula.trim() ? cedula.trim() : null;

  if (!normalizedName) {
    return res.status(400).json({ error: 'Patient name is required' });
  }
  if (!normalizedPhone) {
    return res.status(400).json({ error: 'Patient phone is required' });
  }
  if (email !== undefined && email !== '' && typeof email !== 'string') {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (normalizedEmail && !EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  const record = parseProfile(req.body, todayOf(req));
  if (record.error) return res.status(400).json({ error: record.error });

  try {
    // The record of what staff did is written in the same transaction as the patient
    const patient = await prisma.$transaction(async (tx) => {
      const result = await upsertPatient(tx, req.clinicId, {
        name: normalizedName,
        phone: normalizedPhone,
        email: normalizedEmail,
        cedula: normalizedCedula,
        profile: record.data
      });
      await auditPatientUpsert(tx, req, result);
      return result.patient;
    });
    res.status(201).json(patient);
  } catch (err) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('cedula') ? 'cedula' : 'phone';
      return res.status(400).json({ error: `A patient with this ${field} already exists` });
    }
    console.error('Create patient error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update patient
router.put('/:id', async (req, res) => {
  const { name, phone, email, cedula } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : name;
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : phone;
  // Same trim-to-null normalization as POST /, so a whitespace-only value
  // doesn't get stored as a real (and potentially colliding) cedula/email.
  const normalizedEmail = typeof email === 'string' ? (email.trim() || null) : email;
  const normalizedCedula = typeof cedula === 'string' ? (cedula.trim() || null) : cedula;

  if (name !== undefined && (typeof name !== 'string' || !normalizedName)) {
    return res.status(400).json({ error: 'Patient name is required' });
  }
  if (phone !== undefined && (typeof phone !== 'string' || !normalizedPhone)) {
    return res.status(400).json({ error: 'Patient phone is required' });
  }
  if (email !== undefined && email !== '' && typeof email !== 'string') {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (normalizedEmail && !EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  const record = parseProfile(req.body, todayOf(req));
  if (record.error) return res.status(400).json({ error: record.error });

  try {
    const patient = await prisma.$transaction(async (tx) => {
      const previous = await tx.patient.findFirst({ where: inClinic(req, { id: req.params.id }) });
      if (!previous) return null;

      const updated = await tx.patient.update({
        where: { id: previous.id },
        data: {
          ...(normalizedName !== undefined && { name: normalizedName }),
          ...(normalizedPhone !== undefined && { phone: normalizedPhone }),
          ...(email !== undefined && { email: normalizedEmail }),
          ...(cedula !== undefined && { cedula: normalizedCedula }),
          ...record.data
        }
      });

      // Only the names of the fields that changed are kept, never their values
      const changes = diffFields('patient', previous, updated);
      if (changes) await recordAudit(tx, req, { action: 'update', entity: 'patient', entityId: updated.id, changes });
      return updated;
    });

    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(patient);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Patient not found' });
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('cedula') ? 'cedula' : 'phone';
      return res.status(400).json({ error: `A patient with this ${field} already exists` });
    }
    console.error('Update patient error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Delete a patient. This is for records created by mistake: a patient who has
// any appointment is kept, even if all of them are cancelled or completed,
// because that appointment history belongs to the patient (and the database
// would refuse anyway: appointments reference their patient).
const ACTIVE_STATUSES = ['scheduled', 'pending_approval', 'confirmed'];

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const patient = await prisma.patient.findFirst({
      where: inClinic(req, { id }),
      select: { _count: { select: { appointments: true } } }
    });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    if (patient._count.appointments > 0) {
      const active = await prisma.appointment.count({ where: { patientId: id, status: { in: ACTIVE_STATUSES } } });
      return res.status(409).json({
        error: active > 0
          ? 'This patient has active appointments. Cancel them first; a patient with appointment history cannot be deleted.'
          : 'This patient has appointment history and cannot be deleted.'
      });
    }

    // Allergies, medication, history, notes and vital signs are never swept away with the patient (S10-03 to S10-06)
    const [allergies, medications, backgrounds, notes, readings] = await Promise.all([
      prisma.patientAllergy.count({ where: { patientId: id } }),
      prisma.patientMedication.count({ where: { patientId: id } }),
      prisma.patientBackground.count({ where: { patientId: id } }),
      prisma.consultationNote.count({ where: { patientId: id } }),
      prisma.patientVitals.count({ where: { patientId: id } })
    ]);
    if (allergies + medications + backgrounds + notes + readings > 0) {
      return res.status(409).json({ error: 'This patient has clinical data and cannot be deleted.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.patient.delete({ where: { id } });
      await recordAudit(tx, req, { action: 'delete', entity: 'patient', entityId: id });
    });
    res.json({ message: 'Patient deleted successfully' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Patient not found' });
    // an appointment was booked for this patient between the check and the delete
    if (err.code === 'P2003') return res.status(409).json({ error: 'This patient has appointment history or clinical data and cannot be deleted.' });
    console.error('Delete patient error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
