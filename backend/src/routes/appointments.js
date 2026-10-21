const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { sendAppointmentConfirmation } = require('../services/notificationService');
const { getDay, parseISO } = require('date-fns');
const { parsePagination, pageInfo } = require('../utils/pagination');
const { DATE_REGEX, isValidDate, appointmentInstant, clinicDateString } = require('../utils/clinicTime');
const { upsertPatient } = require('../services/patientUpsert');
const { recordAudit, diffFields, describeCreated, auditPatientUpsert } = require('../services/auditLog');
const notificationLog = require('../services/notificationLog');
const { inClinic, findDoctorInClinic } = require('../utils/clinicScope');
const appointmentTypes = require('../services/appointmentTypes');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_STATUSES = ['scheduled', 'pending_approval', 'confirmed', 'arrived', 'in_progress', 'completed', 'no_show', 'cancelled'];
// The patient came (or is being seen) / the visit is over, one way or the other
const ATTENDED_STATUSES = ['arrived', 'in_progress', 'completed'];
const CLOSED_STATUSES = ['completed', 'no_show'];
// Still waiting for the visit to happen; once its time has passed it should have been closed
const OPEN_STATUSES = ['pending_approval', 'scheduled', 'confirmed', 'arrived', 'in_progress'];
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

// Only the patient fields actually consumed by callers (frontend Dashboard,
// notificationService) - avoids pulling the full row (e.g. createdAt) on
// every appointment list/create/update.
const PATIENT_SELECT = { id: true, name: true, phone: true, email: true, cedula: true };
// The kind of visit, as the calendar needs it (name and color; the length is the appointment's own)
const TYPE_SELECT = appointmentTypes.APPOINTMENT_TYPE_SELECT;
const MINUTES_PER_DAY = 24 * 60;
const UNKNOWN_TYPE = 'typeId must be an active appointment type of your clinic';

// Thrown for expected scheduling conflicts inside the appointment transaction,
// so the catch block can tell them apart from unexpected DB/runtime errors.
// `status` is the HTTP status to answer with.
class ScheduleConflictError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// P2034 (serialization failure) can come from any write conflict in the
// transaction, not just a slot clash, so retry a bounded number of times
// instead of assuming it always means "appointment already booked". If the
// conflict is real, the retried attempt's own explicit check throws
// ScheduleConflictError with the correct message; P2034 only reaches the
// caller if it persists across every retry.
async function runSerializableTransaction(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (err) {
      if (err.code === 'P2034' && attempt < maxAttempts) continue;
      throw err;
    }
  }
}

// What "cancelled" leaves out of lists and counts (see DELETE /:id).
const NOT_CANCELLED = { not: 'cancelled' };

// The rules a doctor's slot has to meet, shared by booking and rescheduling: the whole visit
// (from `time` for `durationMinutes`) fits inside one of the doctor's working blocks and does
// not overlap another visit. Back to back is fine.
// Runs inside the caller's transaction. `excludeId` leaves an appointment out
// of the clash check (the one being moved must not clash with itself).
// `checkAvailability: false` skips the schedule check, for an appointment that
// keeps its slot and only needs to know the slot is still free.
async function assertSlotBookable(tx, { doctorId, date, time, durationMinutes = 30, excludeId, occupiedStatus = 400, checkAvailability = true }) {
  const start = appointmentTypes.toMinutes(time);

  if (checkAvailability) {
    const blocks = await tx.availability.findMany({
      where: { doctorId, dayOfWeek: getDay(parseISO(date)) },
      select: { startTime: true, endTime: true }
    });

    // A doctor who has not configured any schedule can be booked at any time
    // (demo simplicity), so only enforce it once there is one.
    const totalAvailabilities = await tx.availability.count({ where: { doctorId } });
    if (totalAvailabilities > 0) {
      const minutes = blocks.map((block) => ({ from: appointmentTypes.toMinutes(block.startTime), to: appointmentTypes.toMinutes(block.endTime) }));
      const startsInABlock = minutes.some((block) => block.from <= start && start < block.to);
      if (!startsInABlock) throw new ScheduleConflictError('The doctor does not work at the selected time');
      if (!minutes.some((block) => block.from <= start && start + durationMinutes <= block.to)) {
        throw new ScheduleConflictError("The appointment does not fit in the doctor's working hours");
      }
    }
  }
  if (start + durationMinutes > MINUTES_PER_DAY) {
    throw new ScheduleConflictError('The appointment cannot run past midnight');
  }

  const sameDay = await tx.appointment.findMany({
    where: {
      doctorId,
      date,
      status: NOT_CANCELLED,
      ...(excludeId && { id: { not: excludeId } })
    },
    select: { time: true, durationMinutes: true }
  });
  if (sameDay.some((other) => appointmentTypes.overlaps(start, durationMinutes, appointmentTypes.toMinutes(other.time), other.durationMinutes))) {
    throw new ScheduleConflictError('An appointment already exists at this time', occupiedStatus);
  }
}

// Which appointments the caller may see, always inside their own clinic: doctors
// only their own, admin/secretary every doctor of the clinic or the one named in
// ?doctorId (a doctor of another clinic matches nothing).
const doctorScope = (req) => {
  const isSpecialRole = req.userRole === 'admin' || req.userRole === 'secretary';
  const { doctorId } = req.query;
  return inClinic(req, isSpecialRole ? (doctorId ? { doctorId } : {}) : { doctorId: req.doctorId });
};

// List appointments for the doctor, one page at a time. Dates are "YYYY-MM-DD"
// text, so ?from / ?to (inclusive) filter a range, which is what the calendar
// asks for instead of loading the whole history. Cancelled appointments are kept
// in the database but left out unless asked for with ?status=cancelled.
router.get('/', async (req, res) => {
  const { date, from, to, patientId, status } = req.query;

  const paging = parsePagination(req.query, { defaultPageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE });
  if (paging.error) return res.status(400).json({ error: paging.error });
  const { page, pageSize, skip } = paging;

  if (from !== undefined && !isValidDate(from)) {
    return res.status(400).json({ error: 'from must be a valid date (YYYY-MM-DD)' });
  }
  if (to !== undefined && !isValidDate(to)) {
    return res.status(400).json({ error: 'to must be a valid date (YYYY-MM-DD)' });
  }
  if (from !== undefined && to !== undefined && from > to) {
    return res.status(400).json({ error: 'from must not be after to' });
  }

  try {
    // An exact ?date wins over a ?from/?to range.
    const dateFilter = date || ((from || to) && { ...(from && { gte: from }), ...(to && { lte: to }) });
    const where = {
      ...doctorScope(req),
      ...(dateFilter && { date: dateFilter }),
      ...(patientId && { patientId }),
      status: status || NOT_CANCELLED
    };

    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: { patient: { select: PATIENT_SELECT }, doctor: { select: { name: true } }, type: { select: TYPE_SELECT } },
        // id as the last key keeps the order (and so the pages) stable when two
        // doctors have an appointment at the same date and time
        orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
        skip,
        take: pageSize
      }),
      prisma.appointment.count({ where })
    ]);

    res.json({
      appointments: appointments.map(apt => ({ ...apt, Patient: apt.patient })),
      ...pageInfo({ total, page, pageSize })
    });
  } catch (err) {
    console.error('List appointments error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Headline numbers for the dashboard, computed in the database so they don't
// depend on loading every appointment. Same visibility rules as the list.
// total/patients leave out cancelled appointments (those are counted apart, as
// `cancelled`); "positive" = confirmed or completed.
router.get('/stats', async (req, res) => {
  try {
    const scope = doctorScope(req);
    const active = { ...scope, status: NOT_CANCELLED };
    const [total, positive, cancelled, patients] = await Promise.all([
      prisma.appointment.count({ where: active }),
      prisma.appointment.count({ where: { ...scope, status: { in: ['confirmed', ...ATTENDED_STATUSES] } } }),
      prisma.appointment.count({ where: { ...scope, status: 'cancelled' } }),
      prisma.appointment.groupBy({ by: ['patientId'], where: active })
    ]);
    const noShow = await prisma.appointment.count({ where: { ...scope, status: 'no_show' } });
    res.json({ total, positive, cancelled, noShow, patients: patients.length });
  } catch (err) {
    console.error('Appointment stats error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Past appointments nobody closed yet (still pending, scheduled, confirmed, arrived or
// in progress although their time is gone): the doctor marks each as completed or
// no-show. Same visibility as the list; the oldest first.
router.get('/unclosed', async (req, res) => {
  try {
    const today = clinicDateString(new Date(), req.clinicTimezone);
    const candidates = await prisma.appointment.findMany({
      where: { ...doctorScope(req), status: { in: OPEN_STATUSES }, date: { lte: today } },
      include: { patient: { select: PATIENT_SELECT }, doctor: { select: { name: true } }, type: { select: TYPE_SELECT } },
      orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }]
    });
    const now = new Date();
    const unclosed = candidates.filter((apt) => appointmentInstant(apt.date, apt.time, req.clinicTimezone) < now);
    res.json({ total: unclosed.length, appointments: unclosed.slice(0, 50).map((apt) => ({ ...apt, Patient: apt.patient })) });
  } catch (err) {
    console.error('Unclosed appointments error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// No-show control for one month (?month=YYYY-MM, this month by default): of the visits
// already closed, how many the patient missed; how many of the month's appointments
// are confirmed against still waiting for the patient's answer; and who misses the most (all time). Same visibility as the list.
router.get('/attendance', async (req, res) => {
  const month = req.query.month ?? clinicDateString(new Date(), req.clinicTimezone).slice(0, 7);
  if (typeof month !== 'string' || !MONTH_REGEX.test(month)) {
    return res.status(400).json({ error: 'month must be a valid month (YYYY-MM)' });
  }

  try {
    const scope = doctorScope(req);
    const inMonth = { ...scope, date: { gte: `${month}-01`, lte: `${month}-31` } };
    const [attended, noShow, confirmed, notConfirmed, byPatient] = await Promise.all([
      prisma.appointment.count({ where: { ...inMonth, status: { in: ATTENDED_STATUSES } } }),
      prisma.appointment.count({ where: { ...inMonth, status: 'no_show' } }),
      prisma.appointment.count({ where: { ...inMonth, status: 'confirmed' } }),
      prisma.appointment.count({ where: { ...inMonth, status: { in: ['pending_approval', 'scheduled'] } } }),
      prisma.appointment.groupBy({
        by: ['patientId'],
        where: { ...scope, status: 'no_show' },
        _count: { _all: true },
        orderBy: { _count: { patientId: 'desc' } },
        take: 10
      })
    ]);
    const patients = await prisma.patient.findMany({
      where: inClinic(req, { id: { in: byPatient.map((row) => row.patientId) } }),
      select: { id: true, name: true }
    });
    const names = new Map(patients.map((p) => [p.id, p.name]));
    const closed = attended + noShow;

    res.json({
      month,
      attended,
      noShow,
      noShowRate: closed > 0 ? Math.round((noShow / closed) * 1000) / 10 : null,
      confirmed,
      notConfirmed,
      noShowByPatient: byPatient.map((row) => ({
        patientId: row.patientId,
        name: names.get(row.patientId) || '',
        noShows: row._count._all
      }))
    });
  } catch (err) {
    console.error('Attendance error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// What happened to the messages sent about an appointment (confirmation, reminder,
// the doctor's notice): through which channel and provider, and why a failed one
// failed. Same visibility as the appointment: a doctor only sees their own.
router.get('/:id/notifications', async (req, res) => {
  const isSpecialRole = req.userRole === 'admin' || req.userRole === 'secretary';
  try {
    const appointment = await prisma.appointment.findFirst({
      where: inClinic(req, { id: req.params.id, ...(isSpecialRole ? {} : { doctorId: req.doctorId }) }),
      select: { id: true, status: true, date: true, time: true, reminderSentAt: true }
    });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    res.json({
      notifications: await notificationLog.forAppointment(req.clinicId, appointment.id),
      // Whether the 24h reminder is still owed (see tasks/reminderTask.js)
      reminderPending: !appointment.reminderSentAt && ['pending_approval', 'scheduled', 'confirmed'].includes(appointment.status)
    });
  } catch (err) {
    console.error('Appointment notifications error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Create appointment with validations
router.post('/', async (req, res) => {
  const { patientName, patientPhone, patientEmail, patientCedula, date, time, notes, doctorId, typeId } = req.body;
  const targetDoctorId = (req.userRole === 'admin' || req.userRole === 'secretary') && doctorId
    ? doctorId
    : req.doctorId;

  const normalizedPatientName = typeof patientName === 'string' ? patientName.trim() : '';
  const normalizedPatientPhone = typeof patientPhone === 'string' ? patientPhone.trim() : '';
  // Empty string (sent by the "optional" cedula/email fields in the booking
  // form) must become null, not "" - cedula is @unique, so leaving it as an
  // empty string collides with the next patient created without one.
  const normalizedPatientCedula = typeof patientCedula === 'string' && patientCedula.trim() ? patientCedula.trim() : null;
  const normalizedPatientEmail = typeof patientEmail === 'string' && patientEmail.trim() ? patientEmail.trim() : null;

  if (!normalizedPatientName) {
    return res.status(400).json({ error: 'Patient name is required' });
  }
  if (!normalizedPatientPhone) {
    return res.status(400).json({ error: 'Patient phone is required' });
  }
  if (typeof date !== 'string' || !DATE_REGEX.test(date) || isNaN(parseISO(date).getTime())) {
    return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required' });
  }
  if (typeof time !== 'string' || !TIME_REGEX.test(time)) {
    return res.status(400).json({ error: 'A valid time (HH:MM) is required' });
  }

  try {
    // The agenda being booked must be a doctor of the caller's own clinic
    if (!(await findDoctorInClinic(prisma, req, targetDoctorId))) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // Availability + conflict check + patient upsert + creation all run inside a
    // single Serializable transaction, so two concurrent requests for the same
    // doctor/date/time can never both pass the conflict check and double-book
    // the slot (Postgres detects the write conflict and Prisma retries/aborts).
    const appointment = await runSerializableTransaction(async (tx) => {
      // 1. The kind of visit (the clinic's default one unless another is asked for) decides
      // how long it takes, then availability + conflict check (same rules as rescheduling)
      const type = await appointmentTypes.resolveBookableType(tx, req.clinicId, typeId);
      if (!type) throw new ScheduleConflictError(UNKNOWN_TYPE);
      await assertSlotBookable(tx, { doctorId: targetDoctorId, date, time, durationMinutes: type.durationMinutes });

      // 2. Find or update the patient (a booking made by staff also leaves a
      // record of the patient it created or changed)
      const { patient, previous } = await upsertPatient(tx, req.clinicId, {
        name: normalizedPatientName,
        phone: normalizedPatientPhone,
        email: normalizedPatientEmail,
        cedula: normalizedPatientCedula
      });
      await auditPatientUpsert(tx, req, { previous, patient });

      // 3. Create Appointment
      const created = await tx.appointment.create({
        data: {
          clinicId: req.clinicId,
          date,
          time,
          notes,
          patientId: patient.id,
          doctorId: targetDoctorId,
          typeId: type.id,
          durationMinutes: type.durationMinutes,
          status: 'pending_approval' // Default always pending for confirmation
        },
        include: {
          type: { select: TYPE_SELECT },
          patient: { select: PATIENT_SELECT },
          doctor: { select: { id: true, name: true, email: true, role: true, address: true } }
        }
      });
      await recordAudit(tx, req, {
        action: 'create',
        entity: 'appointment',
        entityId: created.id,
        doctorId: targetDoctorId,
        changes: describeCreated('appointment', created)
      });
      return created;
    });

    // 4. Send Notification (WhatsApp + Email) - outside the transaction, after commit
    console.log('Sending confirmation for appointment:', appointment.id);
    await sendAppointmentConfirmation(appointment);

    res.status(201).json({ ...appointment, Patient: appointment.patient });
  } catch (err) {
    if (err instanceof ScheduleConflictError) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2034') {
      return res.status(409).json({ error: 'Could not complete the booking due to a concurrent update, please try again' });
    }
    if (err.code === 'P2002') {
      // Appointment itself has no unique constraints, so this can only come
      // from the Patient upsert above - map its known unique fields to a
      // clear message, and fall back to a generic one for anything else. The
      // constraints are per clinic ([clinicId, cedula]), so look for the field
      // among the columns instead of taking the first one.
      const target = Array.isArray(err.meta?.target) ? err.meta.target.find((field) => field !== 'clinicId') : null;
      const fieldMessages = {
        cedula: 'A patient with this cedula already exists',
        phone: 'A patient with this phone already exists'
      };
      console.error('Appointment creation unique constraint error:', err.message);
      return res.status(400).json({ error: fieldMessages[target] || 'A patient with these details already exists' });
    }
    console.error('Appointment creation error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update appointment (Status, Date/Time, Notes). Moving it to another slot, or
// bringing a cancelled one back, goes through the same checks as booking, so
// an appointment can never end up on a taken slot or outside the doctor's
// schedule: 400 for a time the doctor does not work or one already gone, 409
// for a slot someone else holds.
router.put('/:id', async (req, res) => {
  const { date, time, status, notes, typeId } = req.body;
  const isSpecialRole = req.userRole === 'admin' || req.userRole === 'secretary';

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  if (date !== undefined && (typeof date !== 'string' || !DATE_REGEX.test(date) || isNaN(parseISO(date).getTime()))) {
    return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required' });
  }
  if (time !== undefined && (typeof time !== 'string' || !TIME_REGEX.test(time))) {
    return res.status(400).json({ error: 'A valid time (HH:MM) is required' });
  }
  if (typeId !== undefined && (typeof typeId !== 'string' || !typeId)) {
    return res.status(400).json({ error: UNKNOWN_TYPE });
  }

  try {
    // Read, check and write in one Serializable transaction, like booking, so
    // two moves into the same slot cannot both get through.
    const appointment = await runSerializableTransaction(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: inClinic(req, {
          id: req.params.id,
          ...(isSpecialRole ? {} : { doctorId: req.doctorId })
        })
      });
      if (!current) return null;

      const nextDate = date ?? current.date;
      const nextTime = time ?? current.time;
      const nextStatus = status ?? current.status;
      const moved = nextDate !== current.date || nextTime !== current.time;
      const reactivated = current.status === 'cancelled' && nextStatus !== 'cancelled';

      // Another kind of visit may last longer or shorter, so it takes the agenda again.
      // Asking for the type it already has changes nothing (it may even be archived by now).
      let nextType = null;
      if (typeId !== undefined && typeId !== current.typeId) {
        nextType = await appointmentTypes.resolveBookableType(tx, req.clinicId, typeId);
        if (!nextType) throw new ScheduleConflictError(UNKNOWN_TYPE);
      }
      const nextDuration = nextType ? nextType.durationMinutes : current.durationMinutes;
      const resized = nextDuration !== current.durationMinutes;

      // A visit can only be missed once its time has come
      if (nextStatus === 'no_show' && current.status !== 'no_show' && appointmentInstant(nextDate, nextTime, req.clinicTimezone) > new Date()) {
        throw new ScheduleConflictError('An appointment cannot be marked as no-show before its time');
      }

      // A cancelled appointment holds no slot, so there is nothing to check.
      if (nextStatus !== 'cancelled' && (moved || reactivated || resized)) {
        // Rescheduling to a time that has passed makes no sense, except for
        // an appointment already marked as done (correcting its record).
        if (moved && !CLOSED_STATUSES.includes(nextStatus) && appointmentInstant(nextDate, nextTime, req.clinicTimezone) < new Date()) {
          throw new ScheduleConflictError('The appointment cannot be moved to a time that has already passed');
        }
        await assertSlotBookable(tx, {
          doctorId: current.doctorId,
          date: nextDate,
          time: nextTime,
          durationMinutes: nextDuration,
          excludeId: current.id,
          occupiedStatus: 409,
          // The schedule only matters when the slot or its length changes; a reactivated
          // appointment keeps the slot it was booked in.
          checkAvailability: moved || resized
        });
      }

      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: {
          ...(date && { date }),
          ...(time && { time }),
          ...(status && { status }),
          ...(notes && { notes }),
          ...(nextType && { typeId: nextType.id, durationMinutes: nextType.durationMinutes })
        },
        include: { patient: { select: PATIENT_SELECT }, type: { select: TYPE_SELECT } }
      });

      // A request that changes nothing leaves no record
      const changes = diffFields('appointment', current, updated);
      if (changes) {
        await recordAudit(tx, req, {
          // Moving into "cancelled" is a cancellation whichever route it took
          action: current.status !== 'cancelled' && updated.status === 'cancelled' ? 'cancel' : 'update',
          entity: 'appointment',
          entityId: updated.id,
          doctorId: updated.doctorId,
          changes
        });
      }
      return updated;
    });

    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ ...appointment, Patient: appointment.patient });
  } catch (err) {
    if (err instanceof ScheduleConflictError) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2034') {
      return res.status(409).json({ error: 'Could not complete the update due to a concurrent update, please try again' });
    }
    console.error('Update appointment error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Cancel an appointment. It is kept with status "cancelled" instead of being
// deleted, so the patient's history and the statistics survive; the slot is
// free again because the booking conflict check and /slots ignore cancelled
// appointments, and the reminder task never picks them up. Cancelling one that
// is already cancelled is fine (same result).
router.delete('/:id', async (req, res) => {
  const isSpecialRole = req.userRole === 'admin' || req.userRole === 'secretary';

  try {
    // Serializable, like booking and rescheduling, so two simultaneous
    // cancellations cannot both leave a record of the same cancellation.
    const appointment = await runSerializableTransaction(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: inClinic(req, {
          id: req.params.id,
          ...(isSpecialRole ? {} : { doctorId: req.doctorId })
        })
      });
      if (!current) return null;

      const cancelled = await tx.appointment.update({
        where: { id: current.id },
        data: { status: 'cancelled' },
        include: { patient: { select: PATIENT_SELECT }, type: { select: TYPE_SELECT } }
      });

      // Cancelling one that is already cancelled changes nothing, so it leaves no record
      if (current.status !== 'cancelled') {
        await recordAudit(tx, req, {
          action: 'cancel',
          entity: 'appointment',
          entityId: current.id,
          doctorId: current.doctorId,
          changes: diffFields('appointment', current, cancelled)
        });
      }
      return cancelled;
    });

    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ message: 'Appointment cancelled successfully', appointment: { ...appointment, Patient: appointment.patient } });
  } catch (err) {
    if (err.code === 'P2034') {
      return res.status(409).json({ error: 'Could not complete the cancellation due to a concurrent update, please try again' });
    }
    console.error('Cancel appointment error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
