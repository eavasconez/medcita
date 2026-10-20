const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { sendAppointmentConfirmation } = require('../services/notificationService');
const { getDay, parseISO } = require('date-fns');
const { parsePagination, pageInfo } = require('../utils/pagination');
const { DATE_REGEX, isValidDate, appointmentInstant } = require('../utils/clinicTime');
const { upsertPatient } = require('../services/patientUpsert');
const { recordAudit, diffFields, describeCreated, auditPatientUpsert } = require('../services/auditLog');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_STATUSES = ['scheduled', 'pending_approval', 'confirmed', 'completed', 'cancelled'];

// Only the patient fields actually consumed by callers (frontend Dashboard,
// notificationService) - avoids pulling the full row (e.g. createdAt) on
// every appointment list/create/update.
const PATIENT_SELECT = { id: true, name: true, phone: true, email: true, cedula: true };

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

// The rules a doctor's slot has to meet, shared by booking and rescheduling.
// Runs inside the caller's transaction. `excludeId` leaves an appointment out
// of the clash check (the one being moved must not clash with itself).
// `checkAvailability: false` skips the schedule check, for an appointment that
// keeps its slot and only needs to know the slot is still free.
async function assertSlotBookable(tx, { doctorId, date, time, excludeId, occupiedStatus = 400, checkAvailability = true }) {
  if (checkAvailability) {
    const availability = await tx.availability.findFirst({
      where: {
        doctorId,
        dayOfWeek: getDay(parseISO(date)),
        startTime: { lte: time },
        endTime: { gte: time }
      }
    });

    // A doctor who has not configured any schedule can be booked at any time
    // (demo simplicity), so only enforce it once there is one.
    const totalAvailabilities = await tx.availability.count({ where: { doctorId } });
    if (totalAvailabilities > 0 && !availability) {
      throw new ScheduleConflictError('The doctor does not work at the selected time');
    }
  }

  const conflict = await tx.appointment.findFirst({
    where: {
      doctorId,
      date,
      time,
      status: NOT_CANCELLED,
      ...(excludeId && { id: { not: excludeId } })
    }
  });
  if (conflict) {
    throw new ScheduleConflictError('An appointment already exists at this time', occupiedStatus);
  }
}

// Which doctors' appointments the caller may see: doctors only their own,
// admin/secretary every doctor or the one named in ?doctorId.
const doctorScope = (req) => {
  const isSpecialRole = req.userRole === 'admin' || req.userRole === 'secretary';
  const { doctorId } = req.query;
  return isSpecialRole ? (doctorId ? { doctorId } : {}) : { doctorId: req.doctorId };
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
        include: { patient: { select: PATIENT_SELECT }, doctor: { select: { name: true } } },
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
      prisma.appointment.count({ where: { ...scope, status: { in: ['confirmed', 'completed'] } } }),
      prisma.appointment.count({ where: { ...scope, status: 'cancelled' } }),
      prisma.appointment.groupBy({ by: ['patientId'], where: active })
    ]);
    res.json({ total, positive, cancelled, patients: patients.length });
  } catch (err) {
    console.error('Appointment stats error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Create appointment with validations
router.post('/', async (req, res) => {
  const { patientName, patientPhone, patientEmail, patientCedula, date, time, notes, doctorId } = req.body;
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
    // Availability + conflict check + patient upsert + creation all run inside a
    // single Serializable transaction, so two concurrent requests for the same
    // doctor/date/time can never both pass the conflict check and double-book
    // the slot (Postgres detects the write conflict and Prisma retries/aborts).
    const appointment = await runSerializableTransaction(async (tx) => {
      // 1. Availability + conflict check (same rules as rescheduling)
      await assertSlotBookable(tx, { doctorId: targetDoctorId, date, time });

      // 2. Find or update the patient (a booking made by staff also leaves a
      // record of the patient it created or changed)
      const { patient, previous } = await upsertPatient(tx, {
        name: normalizedPatientName,
        phone: normalizedPatientPhone,
        email: normalizedPatientEmail,
        cedula: normalizedPatientCedula
      });
      await auditPatientUpsert(tx, req, { previous, patient });

      // 3. Create Appointment
      const created = await tx.appointment.create({
        data: {
          date,
          time,
          notes,
          patientId: patient.id,
          doctorId: targetDoctorId,
          status: 'pending_approval' // Default always pending for confirmation
        },
        include: {
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
      // clear message, and fall back to a generic one for anything else.
      const target = Array.isArray(err.meta?.target) ? err.meta.target[0] : null;
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
  const { date, time, status, notes } = req.body;
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

  try {
    // Read, check and write in one Serializable transaction, like booking, so
    // two moves into the same slot cannot both get through.
    const appointment = await runSerializableTransaction(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: {
          id: req.params.id,
          ...(isSpecialRole ? {} : { doctorId: req.doctorId })
        }
      });
      if (!current) return null;

      const nextDate = date ?? current.date;
      const nextTime = time ?? current.time;
      const nextStatus = status ?? current.status;
      const moved = nextDate !== current.date || nextTime !== current.time;
      const reactivated = current.status === 'cancelled' && nextStatus !== 'cancelled';

      // A cancelled appointment holds no slot, so there is nothing to check.
      if (nextStatus !== 'cancelled' && (moved || reactivated)) {
        // Rescheduling to a time that has passed makes no sense, except for
        // an appointment already marked as done (correcting its record).
        if (moved && nextStatus !== 'completed' && appointmentInstant(nextDate, nextTime) < new Date()) {
          throw new ScheduleConflictError('The appointment cannot be moved to a time that has already passed');
        }
        await assertSlotBookable(tx, {
          doctorId: current.doctorId,
          date: nextDate,
          time: nextTime,
          excludeId: current.id,
          occupiedStatus: 409,
          // The schedule only matters when the slot changes; a reactivated
          // appointment keeps the slot it was booked in.
          checkAvailability: moved
        });
      }

      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: {
          ...(date && { date }),
          ...(time && { time }),
          ...(status && { status }),
          ...(notes && { notes })
        },
        include: { patient: { select: PATIENT_SELECT } }
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
        where: {
          id: req.params.id,
          ...(isSpecialRole ? {} : { doctorId: req.doctorId })
        }
      });
      if (!current) return null;

      const cancelled = await tx.appointment.update({
        where: { id: current.id },
        data: { status: 'cancelled' },
        include: { patient: { select: PATIENT_SELECT } }
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
