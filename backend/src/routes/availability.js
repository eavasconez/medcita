const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');

router.use(auth);

// Get doctor availability
router.get('/', async (req, res) => {
  try {
    const availabilities = await prisma.availability.findMany({
      where: { doctorId: req.doctorId },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' }
      ]
    });
    res.json(availabilities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set/Update availability
router.post('/', async (req, res) => {
  const { schedules } = req.body; // Array of { dayOfWeek, startTime, endTime }
  try {
    // Basic approach: replace all current availabilities with new ones
    await prisma.availability.deleteMany({
      where: { doctorId: req.doctorId }
    });

    const newSchedules = await prisma.availability.createMany({
      data: schedules.map(s => ({
        ...s,
        doctorId: req.doctorId
      }))
    });

    res.json({ message: 'Availability updated successfully', count: newSchedules.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
