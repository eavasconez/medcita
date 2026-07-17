const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';

  if (!normalizedName) {
    return res.status(400).json({ error: 'Patient name is required' });
  }
  if (!normalizedPhone) {
    return res.status(400).json({ error: 'Patient phone is required' });
  }
  if (email !== undefined && email !== '' && (typeof email !== 'string' || !EMAIL_REGEX.test(email))) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  try {
    const patient = await prisma.patient.upsert({
      where: { phone: normalizedPhone },
      update: { name: normalizedName, email, cedula },
      create: { name: normalizedName, phone: normalizedPhone, email, cedula }
    });
    res.status(201).json(patient);
  } catch (err) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('cedula') ? 'cedula' : 'phone';
      return res.status(400).json({ error: `A patient with this ${field} already exists` });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update patient
router.put('/:id', async (req, res) => {
  const { name, phone, email, cedula } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : name;
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : phone;

  if (name !== undefined && (typeof name !== 'string' || !normalizedName)) {
    return res.status(400).json({ error: 'Patient name is required' });
  }
  if (phone !== undefined && (typeof phone !== 'string' || !normalizedPhone)) {
    return res.status(400).json({ error: 'Patient phone is required' });
  }
  if (email !== undefined && email !== '' && (typeof email !== 'string' || !EMAIL_REGEX.test(email))) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  try {
    const patient = await prisma.patient.update({
      where: { id: req.params.id },
      data: {
        ...(normalizedName !== undefined && { name: normalizedName }),
        ...(normalizedPhone !== undefined && { phone: normalizedPhone }),
        ...(email !== undefined && { email: email === '' ? null : email }),
        ...(cedula !== undefined && { cedula })
      }
    });
    res.json(patient);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Patient not found' });
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('cedula') ? 'cedula' : 'phone';
      return res.status(400).json({ error: `A patient with this ${field} already exists` });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
