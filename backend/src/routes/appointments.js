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
    const appointment = await prisma.$transaction(async (tx) => {
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
        update: { name: normalizedPatientName, email: patientEmail, cedula: patientCedula },
        create: { name: normalizedPatientName, phone: normalizedPatientPhone, email: patientEmail, cedula: patientCedula }
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
          doctor: { select: { id: true, name: true, email: true, role: true } }
        }
      });
    }, { isolationLevel: 'Serializable' });

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
    if (err.code === 'P2034') return res.status(400).json({ error: 'Ya existe una cita en este horario' });
    res.status(500).json({ error: err.message });
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
