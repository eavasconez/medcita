const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-attack-mitigation', 10);

// Fields safe to expose about the authenticated user (never the password hash)
const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  specialty: true,
  bio: true,
  createdAt: true,
  _count: { select: { appointments: true } }
};

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedName) return res.status(400).json({ error: 'Name is required' });
  if (!EMAIL_REGEX.test(normalizedEmail)) return res.status(400).json({ error: 'A valid email is required' });
  if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const existingDoctor = await prisma.doctor.findUnique({ where: { email: normalizedEmail } });
    if (existingDoctor) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const doctor = await prisma.doctor.create({
      data: { name: normalizedName, email: normalizedEmail, password: hashedPassword }
    });

    const token = jwt.sign({ id: doctor.id, role: doctor.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.status(201).json({ token, user: { id: doctor.id, name: doctor.name, email: doctor.email, role: doctor.role } });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const doctor = await prisma.doctor.findUnique({ where: { email: normalizedEmail } });
    const isMatch = await bcrypt.compare(password, doctor ? doctor.password : DUMMY_PASSWORD_HASH);
    if (!doctor || !isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: doctor.id, role: doctor.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: doctor.id, name: doctor.name, email: doctor.email, role: doctor.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get the authenticated user's own profile
router.get('/profile', auth, async (req, res) => {
  try {
    const doctor = await prisma.doctor.findUnique({
      where: { id: req.doctorId },
      select: PROFILE_SELECT
    });
    if (!doctor) return res.status(404).json({ error: 'User not found' });
    res.json(doctor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update the authenticated user's own profile (self-service: name/specialty/bio only)
router.put('/profile', auth, async (req, res) => {
  const { name, specialty, bio } = req.body;

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
  }
  if (specialty !== undefined && specialty !== null && typeof specialty !== 'string') {
    return res.status(400).json({ error: 'Specialty must be a string' });
  }
  if (bio !== undefined && bio !== null && typeof bio !== 'string') {
    return res.status(400).json({ error: 'Bio must be a string' });
  }

  const data = {};
  if (name !== undefined) data.name = name.trim();
  // Empty string clears the field (stored as null) instead of a blank value
  if (specialty !== undefined) {
    const trimmed = typeof specialty === 'string' ? specialty.trim() : specialty;
    data.specialty = trimmed ? trimmed : null;
  }
  if (bio !== undefined) {
    const trimmed = typeof bio === 'string' ? bio.trim() : bio;
    data.bio = trimmed ? trimmed : null;
  }

  try {
    const doctor = await prisma.doctor.update({
      where: { id: req.doctorId },
      data,
      select: PROFILE_SELECT
    });
    res.json(doctor);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
