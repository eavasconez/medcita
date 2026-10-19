const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { sendAppointmentConfirmation } = require('../services/notificationService');
const { getDay, parseISO } = require('date-fns');
const { parsePagination, pageInfo } = require('../utils/pagination');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_STATUSES = ['scheduled', 'pending_approval', 'confirmed', 'completed', 'cancelled'];

// Only the patient fields actually consumed by callers (frontend Dashboard,
// notificationService) - avoids pulling the full row (e.g. createdAt) on
// every appointment list/create/update.
const PATIENT_SELECT = { id: true, name: true, phone: true, email: true, cedula: true };

// Thrown for expected scheduling conflicts inside the appointment transaction,
// so the catch block can tell them apart from unexpected DB/runtime errors
class ScheduleConflictError extends Error {}

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

const isValidDate = (value) => typeof value === 'string' && DATE_REGEX.test(value) && !isNaN(parseISO(value).getTime());

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
      // 1. Availability Check (Day of week)
      const dayOfWeek = getDay(parseISO(date));
      const availability = await tx.availability.findFirst({
        where: {
          doctorId: targetDoctorId,
          dayOfWeek: dayOfWeek,
          startTime: { lte: time },
          endTime: { gte: time }
        }
      });

      // Note: For demo simplicity, we might want to skip this if no availability is set
      const totalAvailabilities = await tx.availability.count({ where: { doctorId: targetDoctorId } });
      if (totalAvailabilities > 0 && !availability) {
        throw new ScheduleConflictError('The doctor does not work at the selected time');
      }

      // 2. Conflict Check (Duplicate time for same doctor)
      const conflict = await tx.appointment.findFirst({
        where: {
          doctorId: targetDoctorId,
          date,
          time,
          status: { not: 'cancelled' }
        }
      });

      if (conflict) {
        throw new ScheduleConflictError('An appointment already exists at this time');
      }

      // 3. Upsert Patient
      // On update, only touch email/cedula when a non-empty value was
      // actually submitted - an existing patient rebooking with those
      // fields left blank must keep their previously stored values,
      // not have them wiped to null.
      const patient = await tx.patient.upsert({
        where: { phone: normalizedPatientPhone },
        update: {
          name: normalizedPatientName,
          ...(normalizedPatientEmail && { email: normalizedPatientEmail }),
          ...(normalizedPatientCedula && { cedula: normalizedPatientCedula })
        },
        create: { name: normalizedPatientName, phone: normalizedPatientPhone, email: normalizedPatientEmail, cedula: normalizedPatientCedula }
      });

      // 4. Create Appointment
      return tx.appointment.create({
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
    });

    // 5. Send Notification (WhatsApp + Email) - outside the transaction, after commit
    console.log('Sending confirmation for appointment:', appointment.id);
    await sendAppointmentConfirmation(appointment);

    res.status(201).json({ ...appointment, Patient: appointment.patient });
  } catch (err) {
    if (err instanceof ScheduleConflictError) return res.status(400).json({ error: err.message });
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

// Update appointment (Status, Date/Time, Notes)
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
    const appointment = await prisma.appointment.update({
      where: {
        id: req.params.id,
        ...(isSpecialRole ? {} : { doctorId: req.doctorId })
      },
      data: {
        ...(date && { date }),
        ...(time && { time }),
        ...(status && { status }),
        ...(notes && { notes })
      },
      include: { patient: { select: PATIENT_SELECT } }
    });

    res.json({ ...appointment, Patient: appointment.patient });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Appointment not found' });
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
    const appointment = await prisma.appointment.update({
      where: {
        id: req.params.id,
        ...(isSpecialRole ? {} : { doctorId: req.doctorId })
      },
      data: { status: 'cancelled' },
      include: { patient: { select: PATIENT_SELECT } }
    });
    res.json({ message: 'Appointment cancelled successfully', appointment: { ...appointment, Patient: appointment.patient } });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Appointment not found' });
    console.error('Cancel appointment error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
