const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  try {
    const doctor = await prisma.doctor.findUnique({ where: { email: normalizedEmail } });
    if (!doctor) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, doctor.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: doctor.id, role: doctor.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: doctor.id, name: doctor.name, email: doctor.email, role: doctor.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
