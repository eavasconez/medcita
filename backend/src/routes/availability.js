const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const { getDay, parseISO, addMinutes, format } = require('date-fns');

router.use(auth);

// Get doctor availability
router.get('/', async (req, res) => {
  let { doctorId } = req.query;

  // Defensive check for uninitialized frontend values
  if (doctorId === 'undefined' || doctorId === 'null') {
    doctorId = null; 
  }

  const targetDoctorId = doctorId || req.doctorId;

  try {
    let availabilities = await prisma.availability.findMany({
      where: { doctorId: targetDoctorId },
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
    res.status(500).json({ error: err.message });
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

  if (!date) return res.status(400).json({ error: 'Date is required' });

  try {
    const dayOfWeek = getDay(parseISO(date));
    
    // 1. Get doctor's availability for this day
    let availabilities = await prisma.availability.findMany({
      where: { 
        doctorId: targetDoctorId,
        dayOfWeek: dayOfWeek
      }
    });

    // Fallback for demo: if no availability and it's Mon-Fri (1-5), allow 8-6
    if (availabilities.length === 0 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      availabilities = [{
        startTime: '08:00',
        endTime: '18:00'
      }];
    }

    if (availabilities.length === 0) {
      return res.json([]); // No service this day
    }

    // 2. Get existing appointments
    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId: targetDoctorId,
        date: date,
        status: { not: 'cancelled' }
      },
      select: { time: true }
    });

    const bookedTimes = appointments.map(a => a.time);

    // 3. Generate slots (30 min default)
    const slots = [];
    const SLOT_DURATION = 30;
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');

    availabilities.forEach(avail => {
      let current = parseISO(`${date}T${avail.startTime}`);
      const end = parseISO(`${date}T${avail.endTime}`);

      while (current < end) {
        const timeStr = format(current, 'HH:mm');
        
        // Skip if it's today and the time has already passed
        const isPast = date === todayStr && current < now;

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
    res.status(500).json({ error: err.message });
  }
});

// Set/Update availability
router.post('/', async (req, res) => {
  const { schedules, doctorId } = req.body; // Array of { dayOfWeek, startTime, endTime }
  const isSpecialRole = req.userRole === 'admin' || req.userRole === 'secretary';
  const targetDoctorId = isSpecialRole && doctorId ? doctorId : req.doctorId;

  try {
    // Basic approach: replace all current availabilities with new ones
    await prisma.availability.deleteMany({
      where: { doctorId: targetDoctorId }
    });

    const newSchedules = await prisma.availability.createMany({
      data: schedules.map(s => ({
        ...s,
        doctorId: targetDoctorId
      }))
    });

    res.json({ message: 'Availability updated successfully', count: newSchedules.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
