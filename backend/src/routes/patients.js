const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');

// All patient routes are protected
router.use(auth);

// Get all patients (optionally search by name or phone)
router.get('/', async (req, res) => {
  const { search } = req.query;
  try {
    const patients = await prisma.patient.findMany({
      where: search ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { cedula: { contains: search } }
        ]
      } : {},
      include: {
        _count: {
          select: { appointments: true }
        }
      }
    });
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new patient
router.post('/', async (req, res) => {
  const { name, phone, email, cedula } = req.body;
  try {
    const patient = await prisma.patient.upsert({
      where: { phone },
      update: { name, email, cedula },
      create: { name, phone, email, cedula }
    });
    res.status(201).json(patient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update patient
router.put('/:id', async (req, res) => {
  const { name, phone, email, cedula } = req.body;
  try {
    const patient = await prisma.patient.update({
      where: { id: req.params.id },
      data: { name, phone, email, cedula }
    });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
