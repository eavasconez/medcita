const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { sendAppointmentConfirmation } = require('../services/notificationService');
const { getDay, parseISO } = require('date-fns');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_STATUSES = ['scheduled', 'pending_approval', 'confirmed', 'completed', 'cancelled'];

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

// List appointments for the doctor
router.get('/', async (req, res) => {
  const { date, patientId, doctorId, status } = req.query;
  try {
    const isSpecialRole = req.userRole === 'admin' || req.userRole === 'secretary';
    const appointments = await prisma.appointment.findMany({
      where: {
        ...(isSpecialRole ? (doctorId ? { doctorId } : {}) : { doctorId: req.doctorId }),
        ...(date && { date }),
        ...(patientId && { patientId }),
        ...(status && { status })
      },
      include: { patient: true, doctor: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { time: 'asc' }]
    });
    
    const formatted = appointments.map(apt => ({
      ...apt,
      Patient: apt.patient
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
        throw new ScheduleConflictError('El médico no atiende en el horario seleccionado');
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
        throw new ScheduleConflictError('Ya existe una cita en este horario');
      }

      // 3. Upsert Patient
      const patient = await tx.patient.upsert({
        where: { phone: normalizedPatientPhone },
        update: { name: normalizedPatientName, email: normalizedPatientEmail, cedula: normalizedPatientCedula },
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
          patient: true,
          doctor: { select: { id: true, name: true, email: true, role: true, address: true } }
        }
      });
    });

    // 5. Send Notification (WhatsApp + Email) - outside the transaction, after commit
    console.log('Sending confirmation for appointment:', {
      id: appointment.id,
      patientEmail: appointment.patient.email,
      patientPhone: appointment.patient.phone
    });
    await sendAppointmentConfirmation(appointment);

    res.status(201).json({ ...appointment, Patient: appointment.patient });
  } catch (err) {
    if (err instanceof ScheduleConflictError) return res.status(400).json({ error: err.message });
    if (err.code === 'P2034') {
      return res.status(409).json({ error: 'Could not complete the booking due to a concurrent update, please try again' });
    }
    if (err.code === 'P2002') {
      const field = Array.isArray(err.meta?.target) ? err.meta.target[0] : 'field';
      console.error('Appointment creation unique constraint error:', err.message);
      return res.status(400).json({ error: `A patient with that ${field} already exists` });
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
      include: { patient: true }
    });

    res.json({ ...appointment, Patient: appointment.patient });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Appointment not found' });
    res.status(500).json({ error: err.message });
  }
});

// Delete appointment
router.delete('/:id', async (req, res) => {
  const isSpecialRole = req.userRole === 'admin' || req.userRole === 'secretary';

  try {
    await prisma.appointment.delete({
      where: {
        id: req.params.id,
        ...(isSpecialRole ? {} : { doctorId: req.doctorId })
      }
    });
    res.json({ message: 'Appointment cancelled successfully' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Appointment not found' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
