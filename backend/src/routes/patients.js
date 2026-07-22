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
    console.error('List patients error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Create new patient
router.post('/', async (req, res) => {
  const { name, phone, email, cedula } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
  // Empty string means "not provided" here, not a value to store - cedula is
  // @unique, so leaving it as "" collides with the next cedula-less patient.
  const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim() : null;
  const normalizedCedula = typeof cedula === 'string' && cedula.trim() ? cedula.trim() : null;

  if (!normalizedName) {
    return res.status(400).json({ error: 'Patient name is required' });
  }
  if (!normalizedPhone) {
    return res.status(400).json({ error: 'Patient phone is required' });
  }
  if (email !== undefined && email !== '' && typeof email !== 'string') {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (normalizedEmail && !EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  try {
    const patient = await prisma.patient.upsert({
      where: { phone: normalizedPhone },
      update: {
        name: normalizedName,
        ...(normalizedEmail && { email: normalizedEmail }),
        ...(normalizedCedula && { cedula: normalizedCedula })
      },
      create: { name: normalizedName, phone: normalizedPhone, email: normalizedEmail, cedula: normalizedCedula }
    });
    res.status(201).json(patient);
  } catch (err) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('cedula') ? 'cedula' : 'phone';
      return res.status(400).json({ error: `A patient with this ${field} already exists` });
    }
    console.error('Create patient error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update patient
router.put('/:id', async (req, res) => {
  const { name, phone, email, cedula } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : name;
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : phone;
  // Same trim-to-null normalization as POST /, so a whitespace-only value
  // doesn't get stored as a real (and potentially colliding) cedula/email.
  const normalizedEmail = typeof email === 'string' ? (email.trim() || null) : email;
  const normalizedCedula = typeof cedula === 'string' ? (cedula.trim() || null) : cedula;

  if (name !== undefined && (typeof name !== 'string' || !normalizedName)) {
    return res.status(400).json({ error: 'Patient name is required' });
  }
  if (phone !== undefined && (typeof phone !== 'string' || !normalizedPhone)) {
    return res.status(400).json({ error: 'Patient phone is required' });
  }
  if (email !== undefined && email !== '' && typeof email !== 'string') {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (normalizedEmail && !EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  try {
    const patient = await prisma.patient.update({
      where: { id: req.params.id },
      data: {
        ...(normalizedName !== undefined && { name: normalizedName }),
        ...(normalizedPhone !== undefined && { phone: normalizedPhone }),
        ...(email !== undefined && { email: normalizedEmail }),
        ...(cedula !== undefined && { cedula: normalizedCedula })
      }
    });
    res.json(patient);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Patient not found' });
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('cedula') ? 'cedula' : 'phone';
      return res.status(400).json({ error: `A patient with this ${field} already exists` });
    }
    console.error('Update patient error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
