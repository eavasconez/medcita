const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const { getDay, parseISO, addMinutes, format } = require('date-fns');
const { clinicDateString, appointmentInstant } = require('../utils/clinicTime');
const { inClinic, findDoctorInClinic } = require('../utils/clinicScope');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

router.use(auth);

// A schedule can only be read or changed for a doctor of the caller's own clinic.
// The caller is always one, so only another id needs looking up; one that is not
// in the clinic (or does not exist at all) is answered with a 404.
const isDoctorOfClinic = async (req, doctorId) =>
  doctorId === req.doctorId || Boolean(await findDoctorInClinic(prisma, req, doctorId));

// Get doctor availability
router.get('/', async (req, res) => {
  let { doctorId } = req.query;

  // Defensive check for uninitialized frontend values
  if (doctorId === 'undefined' || doctorId === 'null') {
    doctorId = null; 
  }

  const targetDoctorId = doctorId || req.doctorId;

  try {
    if (!(await isDoctorOfClinic(req, targetDoctorId))) return res.status(404).json({ error: 'Doctor not found' });

    let availabilities = await prisma.availability.findMany({
      where: inClinic(req, { doctorId: targetDoctorId }),
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' }
      ]
    });

    // Fallback for demo: if no availability, return Mon-Fri 8-6
    if (availabilities.length === 0) {
      availabilities = [1, 2, 3, 4, 5].map(day => ({
        dayOfWeek: day,
        startTime: '08:00',
        endTime: '18:00',
        doctorId: targetDoctorId,
        isDefault: true
      }));
    }

    res.json(availabilities);
  } catch (err) {
    console.error('Get availability error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Get free slots for a specific date
router.get('/slots', async (req, res) => {
  let { date, doctorId } = req.query;
  
  // Defensive check for uninitialized frontend values
  if (doctorId === 'undefined' || doctorId === 'null') {
    doctorId = null; 
  }

  const targetDoctorId = doctorId || req.doctorId;

  if (typeof date !== 'string' || !DATE_REGEX.test(date) || isNaN(parseISO(date).getTime())) {
    return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required' });
  }

  try {
    if (!(await isDoctorOfClinic(req, targetDoctorId))) return res.status(404).json({ error: 'Doctor not found' });

    const dayOfWeek = getDay(parseISO(date));
    
    // 1. Get doctor's availability for this day
    let availabilities = await prisma.availability.findMany({
      where: inClinic(req, {
        doctorId: targetDoctorId,
        dayOfWeek: dayOfWeek
      })
    });

    // Fallback for demo: a doctor who has NOT configured any schedule works
    // Mon-Fri (1-5) 8-6, same as GET / and the check in POST /api/appointments.
    // A doctor with a schedule that simply skips this day does not work it, so
    // it must not be offered here just because the day is a weekday.
    if (availabilities.length === 0 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      const configured = await prisma.availability.count({ where: inClinic(req, { doctorId: targetDoctorId }) });
      if (configured === 0) {
        availabilities = [{
          startTime: '08:00',
          endTime: '18:00'
        }];
      }
    }

    if (availabilities.length === 0) {
      return res.json([]); // No service this day
    }

    // 2. Get existing appointments
    const appointments = await prisma.appointment.findMany({
      where: inClinic(req, {
        doctorId: targetDoctorId,
        date: date,
        status: { not: 'cancelled' }
      }),
      select: { time: true }
    });

    const bookedTimes = appointments.map(a => a.time);

    // 3. Generate slots (30 min default)
    const slots = [];
    const SLOT_DURATION = 30;
    const now = new Date();
    // "Today" and "already passed" are decided in the clinic's time, not the server's
    // (Render runs in UTC, which made every slot of the day look past from midday on)
    const todayStr = clinicDateString(now);

    availabilities.forEach(avail => {
      let current = parseISO(`${date}T${avail.startTime}`);
      const end = parseISO(`${date}T${avail.endTime}`);

      while (current < end) {
        const timeStr = format(current, 'HH:mm');
        
        // Skip if it's today and the time has already passed
        const isPast = date === todayStr && appointmentInstant(date, timeStr) < now;

        if (!isPast) {
          slots.push({
            time: timeStr,
            status: bookedTimes.includes(timeStr) ? 'booked' : 'available'
          });
        }
        current = addMinutes(current, SLOT_DURATION);
      }
    });

    res.json(slots);
  } catch (err) {
    console.error('Get free slots error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Set/Update availability
router.post('/', async (req, res) => {
  const { schedules, doctorId } = req.body; // Array of { dayOfWeek, startTime, endTime }
  const isSpecialRole = req.userRole === 'admin' || req.userRole === 'secretary';
  const targetDoctorId = isSpecialRole && doctorId ? doctorId : req.doctorId;

  if (!Array.isArray(schedules) || schedules.length === 0) {
    return res.status(400).json({ error: 'schedules must be a non-empty array' });
  }

  const seen = new Set();
  for (const s of schedules) {
    const { dayOfWeek, startTime, endTime } = s || {};

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ error: 'dayOfWeek must be an integer between 0 (Sunday) and 6 (Saturday)' });
    }
    if (typeof startTime !== 'string' || !TIME_REGEX.test(startTime)) {
      return res.status(400).json({ error: 'startTime must be a valid time (HH:MM)' });
    }
    if (typeof endTime !== 'string' || !TIME_REGEX.test(endTime)) {
      return res.status(400).json({ error: 'endTime must be a valid time (HH:MM)' });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'startTime must be earlier than endTime' });
    }

    const key = `${dayOfWeek}-${startTime}`;
    if (seen.has(key)) {
      return res.status(400).json({ error: `Duplicate schedule for day ${dayOfWeek} at ${startTime}` });
    }
    seen.add(key);
  }

  try {
    if (!(await isDoctorOfClinic(req, targetDoctorId))) return res.status(404).json({ error: 'Doctor not found' });

    // Replace all current availabilities with the new ones atomically, so a
    // failure never leaves the doctor with the old set deleted and nothing in its place
    const newSchedules = await prisma.$transaction(async (tx) => {
      await tx.availability.deleteMany({ where: inClinic(req, { doctorId: targetDoctorId }) });
      return tx.availability.createMany({
        data: schedules.map(s => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          doctorId: targetDoctorId,
          clinicId: req.clinicId
        }))
      });
    });

    res.json({ message: 'Availability updated successfully', count: newSchedules.count });
  } catch (err) {
    console.error('Set availability error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
