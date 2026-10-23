const express = require('express');
const prisma = require('../config/prisma');
const { inClinic } = require('../utils/clinicScope');
const { recordClinicalRead, recordClinicalWrite, describeCreated, describeRemoved } = require('../services/auditLog');
const notes = require('../services/consultationNotes');
const diagnoses = require('../services/diagnoses');
const { OPEN_STATUSES } = require('../utils/appointmentStatus');

// Mounted by routes/clinicalBackground.js on /api/patients/:id/clinical/notes: already behind
// auth, middleware/clinicalAccess.js (doctors and admins) and the lookup of the patient inside
// the caller's clinic (req.patientId). Every read leaves an audit entry; drafts are not logged
// save by save (see services/auditLog.js).
//
// The rules of a note:
//  - one per appointment, started by a doctor or an admin, who becomes its author;
//  - only the author edits the draft, and only while it is a draft;
//  - closing is final: from then on the only change is an addendum, by any doctor or admin;
//  - a draft written by mistake can be deleted by its author; a closed note never.
const router = express.Router({ mergeParams: true });

const unexpected = (res, err, what) => {
  console.error(`${what} error:`, err);
  res.status(500).json({ error: 'An unexpected error occurred' });
};

const AUTHOR_ONLY = 'Only the author of a draft can edit it';
const isRevision = (value) => Number.isInteger(value) && value >= 1;

const summaryOf = (note) => ({
  id: note.id,
  appointmentId: note.appointmentId,
  status: note.status,
  template: note.template,
  authorId: note.authorId,
  authorName: note.authorName,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
  closedAt: note.closedAt,
  appointment: note.appointment && {
    date: note.appointment.date,
    time: note.appointment.time,
    doctor: note.appointment.doctor.name
  },
  addendaCount: note._count?.addenda ?? 0,
  // The diagnosis the visit is about, when the note has one (the list shows it without opening the note)
  principalDiagnosis: note.diagnoses?.find((d) => d.kind === 'primary')
    ? { code: note.diagnoses.find((d) => d.kind === 'primary').code, name: note.diagnoses.find((d) => d.kind === 'primary').name }
    : null
});

// The main diagnosis first, then in the order they were added
const sortedDiagnoses = (rows) => [...rows].sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary') || a.createdAt - b.createdAt);

const findNote = (req, include = {}) =>
  prisma.consultationNote.findFirst({
    where: { id: req.params.noteId, patientId: req.patientId, clinicId: req.clinicId },
    include
  });

router.get('/templates', (req, res) => res.json(notes.templateList()));

// The notes of the patient, newest first, without their text: who wrote what and when.
router.get('/', async (req, res) => {
  try {
    const rows = await prisma.consultationNote.findMany({
      where: { patientId: req.patientId, clinicId: req.clinicId },
      orderBy: { createdAt: 'desc' },
      include: {
        appointment: { select: { date: true, time: true, doctor: { select: { name: true } } } },
        _count: { select: { addenda: true } },
        diagnoses: { select: { kind: true, code: true, name: true } }
      }
    });
    await recordClinicalRead(prisma, req, { patientId: req.patientId, section: 'notes' });
    res.json(rows.map(summaryOf));
  } catch (err) {
    unexpected(res, err, 'List consultation notes');
  }
});

// One note with its text and its addenda.
router.get('/:noteId', async (req, res) => {
  try {
    const note = await findNote(req, {
      appointment: { select: { date: true, time: true, doctor: { select: { name: true } } } },
      addenda: { orderBy: { createdAt: 'asc' } },
      diagnoses: { orderBy: { createdAt: 'asc' } }
    });
    if (!note) return res.status(404).json({ error: 'Note not found' });
    await recordClinicalRead(prisma, req, { patientId: req.patientId, section: `note:${note.id}` });
    const { addenda, ...fields } = note;
    res.json({ ...summaryOf(note), ...Object.fromEntries(notes.SECTIONS.map((s) => [s, fields[s]])), revision: note.revision, addenda, diagnoses: sortedDiagnoses(note.diagnoses) });
  } catch (err) {
    unexpected(res, err, 'Get consultation note');
  }
});

// Start the note of an appointment from a template.
router.post('/', async (req, res) => {
  const { appointmentId, template = 'general' } = req.body || {};
  if (typeof appointmentId !== 'string' || !appointmentId) return res.status(400).json({ error: 'appointmentId is required' });
  const sections = notes.sectionsOf(template);
  if (!sections) return res.status(400).json({ error: `template must be one of: ${Object.keys(notes.TEMPLATES).join(', ')}` });

  try {
    const appointment = await prisma.appointment.findFirst({
      where: inClinic(req, { id: appointmentId, patientId: req.patientId }),
      select: { id: true, status: true }
    });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    if (appointment.status === 'cancelled') return res.status(409).json({ error: 'A cancelled appointment has no consultation note' });

    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.consultationNote.findUnique({ where: { appointmentId: appointment.id }, select: { id: true } });
      if (existing) return { existing };
      const note = await tx.consultationNote.create({
        data: {
          ...sections,
          template,
          appointmentId: appointment.id,
          patientId: req.patientId,
          clinicId: req.clinicId,
          authorId: req.doctorId,
          authorName: req.userName
        }
      });
      await recordClinicalWrite(tx, req, { action: 'create', entity: 'consultation_note', entityId: note.id, changes: describeCreated('consultation_note', note) });
      return { note };
    });

    if (created.existing) return res.status(409).json({ error: 'This appointment already has a consultation note', noteId: created.existing.id });
    res.status(201).json(created.note);
  } catch (err) {
    // two doctors starting the note of the same appointment at once
    if (err.code === 'P2002') return res.status(409).json({ error: 'This appointment already has a consultation note' });
    unexpected(res, err, 'Create consultation note');
  }
});

// Save the draft. `revision` is the number the screen last saw: if someone saved in between
// (another tab, a flaky connection that retried) the save is refused instead of overwriting.
router.put('/:noteId', async (req, res) => {
  if (!isRevision(req.body?.revision)) return res.status(400).json({ error: 'revision is required' });
  const parsed = notes.parseSections(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const note = await findNote(req);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (note.status !== 'draft') return res.status(409).json({ error: 'This note is closed. Add an addendum instead.' });
    if (note.authorId !== req.doctorId) return res.status(403).json({ error: AUTHOR_ONLY });

    const { count } = await prisma.consultationNote.updateMany({
      where: { id: note.id, status: 'draft', revision: req.body.revision, authorId: req.doctorId },
      data: { ...parsed.data, revision: { increment: 1 } }
    });
    if (count === 0) {
      const current = await findNote(req);
      if (current.status !== 'draft') return res.status(409).json({ error: 'This note is closed. Add an addendum instead.' });
      return res.status(409).json({ error: 'The note changed since you opened it. Reload it to continue.', currentRevision: current.revision });
    }
    const saved = await findNote(req);
    res.json({ revision: saved.revision, updatedAt: saved.updatedAt });
  } catch (err) {
    unexpected(res, err, 'Save consultation note');
  }
});

// Close the note: final. Refused if nothing was written beyond the template's headings.
router.post('/:noteId/close', async (req, res) => {
  if (!isRevision(req.body?.revision)) return res.status(400).json({ error: 'revision is required' });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const note = await tx.consultationNote.findFirst({ where: { id: req.params.noteId, patientId: req.patientId, clinicId: req.clinicId } });
      if (!note) return { status: 404, error: 'Note not found' };
      if (note.status !== 'draft') return { status: 409, error: 'This note is already closed' };
      if (note.authorId !== req.doctorId) return { status: 403, error: 'Only the author of a draft can close it' };
      if (note.revision !== req.body.revision) return { status: 409, error: 'The note changed since you opened it. Reload it to continue.', currentRevision: note.revision };
      if (notes.hasNoContent(note)) return { status: 400, error: 'Write something in the note before closing it' };

      const { count } = await tx.consultationNote.updateMany({
        where: { id: note.id, status: 'draft', revision: note.revision },
        data: { status: 'closed', closedAt: new Date(), closedById: req.doctorId, closedByName: req.userName, revision: { increment: 1 } }
      });
      if (count === 0) return { status: 409, error: 'The note changed since you opened it. Reload it to continue.' };
      await recordClinicalWrite(tx, req, {
        action: 'update',
        entity: 'consultation_note',
        entityId: note.id,
        changes: { patientId: { to: note.patientId }, status: { from: 'draft', to: 'closed' } }
      });

      // The visit is over: a still-open appointment becomes "completed" (no_show and cancelled stay as they are)
      const visit = await tx.appointment.findFirst({ where: { id: note.appointmentId, clinicId: req.clinicId }, select: { id: true, status: true } });
      if (visit && OPEN_STATUSES.includes(visit.status)) {
        const moved = await tx.appointment.updateMany({ where: { id: visit.id, status: visit.status }, data: { status: 'completed' } });
        if (moved.count === 1) {
          await recordClinicalWrite(tx, req, {
            action: 'update',
            entity: 'appointment',
            entityId: visit.id,
            changes: { status: { from: visit.status, to: 'completed' } }
          });
        }
      }
      return { status: 200 };
    });

    if (result.status !== 200) return res.status(result.status).json({ error: result.error, ...(result.currentRevision && { currentRevision: result.currentRevision }) });
    res.json({ message: 'Note closed' });
  } catch (err) {
    unexpected(res, err, 'Close consultation note');
  }
});

// A correction or an addition to a closed note.
router.post('/:noteId/addenda', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > notes.MAX_ADDENDUM_LENGTH) return res.status(400).json({ error: `text must be at most ${notes.MAX_ADDENDUM_LENGTH} characters` });

  try {
    const addendum = await prisma.$transaction(async (tx) => {
      const note = await tx.consultationNote.findFirst({ where: { id: req.params.noteId, patientId: req.patientId, clinicId: req.clinicId }, select: { id: true, status: true } });
      if (!note) return { status: 404, error: 'Note not found' };
      if (note.status !== 'closed') return { status: 409, error: 'Only a closed note takes an addendum. Edit the draft instead.' };
      const row = await tx.consultationAddendum.create({
        data: { noteId: note.id, clinicId: req.clinicId, text, authorId: req.doctorId, authorName: req.userName }
      });
      await recordClinicalWrite(tx, req, {
        action: 'create',
        entity: 'consultation_addendum',
        entityId: row.id,
        changes: { patientId: { to: req.patientId }, ...describeCreated('consultation_addendum', row) }
      });
      return { row };
    });
    if (addendum.error) return res.status(addendum.status).json({ error: addendum.error });
    res.status(201).json(addendum.row);
  } catch (err) {
    unexpected(res, err, 'Add addendum');
  }
});

// A draft written by mistake. A closed note is part of the chart and stays.
router.delete('/:noteId', async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Locked first: closing the note cannot slip in between the check and the deletion (its
      // diagnoses go with the draft, and they must not go with a note that was just closed)
      await tx.$queryRaw`SELECT id FROM "ConsultationNote" WHERE id = ${req.params.noteId} AND "patientId" = ${req.patientId} AND "clinicId" = ${req.clinicId} FOR UPDATE`;
      const note = await tx.consultationNote.findFirst({ where: { id: req.params.noteId, patientId: req.patientId, clinicId: req.clinicId } });
      if (!note) return { status: 404, error: 'Note not found' };
      if (note.status !== 'draft') return { status: 409, error: 'A closed note cannot be deleted. Add an addendum instead.' };
      if (note.authorId !== req.doctorId) return { status: 403, error: 'Only the author of a draft can delete it' };
      await tx.consultationDiagnosis.deleteMany({ where: { noteId: note.id } });
      const { count } = await tx.consultationNote.deleteMany({ where: { id: note.id, status: 'draft' } });
      if (count === 0) return { status: 409, error: 'A closed note cannot be deleted. Add an addendum instead.' };
      await recordClinicalWrite(tx, req, { action: 'delete', entity: 'consultation_note', entityId: note.id, changes: describeRemoved('consultation_note', note) });
      return { status: 200 };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ message: 'Draft deleted successfully' });
  } catch (err) {
    unexpected(res, err, 'Delete consultation note');
  }
});

// --- Diagnoses of the note (S10-05) ---------------------------------------------------------
// Like the text of the note, they change only while it is a draft and only by its author. A
// diagnosis is picked from the ICD-10 catalogue (its code and name are copied into the note) or
// typed as free text when it is not in the list.

const KINDS = ['primary', 'secondary'];
const CERTAINTIES = ['presumptive', 'definitive'];
const MAX_DIAGNOSES_PER_NOTE = 20;
const NOT_A_DRAFT = 'This note is closed. Add an addendum instead.';

// The draft of this author, locked for the rest of the transaction so that closing the note
// cannot slip in between the check and the change. -> { note } or { status, error }
async function lockDraft(tx, req) {
  const rows = await tx.$queryRaw`SELECT id FROM "ConsultationNote" WHERE id = ${req.params.noteId} AND "patientId" = ${req.patientId} AND "clinicId" = ${req.clinicId} FOR UPDATE`;
  if (rows.length === 0) return { status: 404, error: 'Note not found' };
  const note = await tx.consultationNote.findUnique({ where: { id: req.params.noteId } });
  if (note.status !== 'draft') return { status: 409, error: NOT_A_DRAFT };
  if (note.authorId !== req.doctorId) return { status: 403, error: AUTHOR_ONLY };
  return { note };
}

router.post('/:noteId/diagnoses', async (req, res) => {
  const { code, name, kind = 'secondary', certainty = 'presumptive' } = req.body || {};
  if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of: ${KINDS.join(', ')}` });
  if (!CERTAINTIES.includes(certainty)) return res.status(400).json({ error: `certainty must be one of: ${CERTAINTIES.join(', ')}` });

  let entry;
  try {
    if (code !== undefined && code !== null && code !== '') {
      if (typeof code !== 'string' || !diagnoses.isCode(code)) return res.status(400).json({ error: 'code is not a valid ICD-10 code' });
      const found = await prisma.diagnosisCode.findFirst({ where: { code: diagnoses.formatCode(code), selectable: true }, select: { code: true, name: true } });
      if (!found) return res.status(400).json({ error: 'That code is not in the diagnosis list' });
      entry = { code: found.code, name: found.name };
    } else {
      const text = typeof name === 'string' ? name.trim() : '';
      if (!text) return res.status(400).json({ error: 'Pick a diagnosis from the list or write its name' });
      if (text.length > diagnoses.MAX_NAME_LENGTH) return res.status(400).json({ error: `name must be at most ${diagnoses.MAX_NAME_LENGTH} characters` });
      entry = { code: null, name: text };
    }

    const result = await prisma.$transaction(async (tx) => {
      const locked = await lockDraft(tx, req);
      if (locked.error) return locked;
      const current = await tx.consultationDiagnosis.findMany({ where: { noteId: locked.note.id }, select: { code: true } });
      if (current.length >= MAX_DIAGNOSES_PER_NOTE) return { status: 409, error: `A note can have at most ${MAX_DIAGNOSES_PER_NOTE} diagnoses` };
      if (entry.code && current.some((d) => d.code === entry.code)) return { status: 409, error: 'This diagnosis is already in the note' };
      // a note has one main diagnosis: the new one takes the place of the old
      if (kind === 'primary') await tx.consultationDiagnosis.updateMany({ where: { noteId: locked.note.id, kind: 'primary' }, data: { kind: 'secondary' } });
      const row = await tx.consultationDiagnosis.create({
        data: { ...entry, kind, certainty, noteId: locked.note.id, patientId: req.patientId, clinicId: req.clinicId, recordedById: req.doctorId, recordedByName: req.userName }
      });
      return { row };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result.row);
  } catch (err) {
    unexpected(res, err, 'Add diagnosis');
  }
});

// Change the kind or the certainty; the name only of a free-text diagnosis (a coded one is
// removed and added again).
router.put('/:noteId/diagnoses/:diagnosisId', async (req, res) => {
  const { kind, certainty, name } = req.body || {};
  if (kind !== undefined && !KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of: ${KINDS.join(', ')}` });
  if (certainty !== undefined && !CERTAINTIES.includes(certainty)) return res.status(400).json({ error: `certainty must be one of: ${CERTAINTIES.join(', ')}` });
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > diagnoses.MAX_NAME_LENGTH)) {
    return res.status(400).json({ error: `name must be text of at most ${diagnoses.MAX_NAME_LENGTH} characters` });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await lockDraft(tx, req);
      if (locked.error) return locked;
      const row = await tx.consultationDiagnosis.findFirst({ where: { id: req.params.diagnosisId, noteId: locked.note.id } });
      if (!row) return { status: 404, error: 'Diagnosis not found' };
      if (name !== undefined && row.code) return { status: 400, error: 'The name of a diagnosis from the list cannot be changed. Remove it and pick another.' };
      if (kind === 'primary') await tx.consultationDiagnosis.updateMany({ where: { noteId: locked.note.id, kind: 'primary', id: { not: row.id } }, data: { kind: 'secondary' } });
      const updated = await tx.consultationDiagnosis.update({
        where: { id: row.id },
        data: { ...(kind !== undefined && { kind }), ...(certainty !== undefined && { certainty }), ...(name !== undefined && { name: name.trim() }) }
      });
      return { row: updated };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.row);
  } catch (err) {
    unexpected(res, err, 'Update diagnosis');
  }
});

router.delete('/:noteId/diagnoses/:diagnosisId', async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await lockDraft(tx, req);
      if (locked.error) return locked;
      const { count } = await tx.consultationDiagnosis.deleteMany({ where: { id: req.params.diagnosisId, noteId: locked.note.id } });
      return count === 0 ? { status: 404, error: 'Diagnosis not found' } : { ok: true };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ message: 'Diagnosis removed' });
  } catch (err) {
    unexpected(res, err, 'Remove diagnosis');
  }
});

module.exports = router;
