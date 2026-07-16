const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const bcrypt = require('bcryptjs');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['admin', 'secretary', 'doctor'];

// Protect all routes with authentication
router.use(auth);

// List all doctors (Accessible by Admin and Secretary)
router.get('/medicos', async (req, res) => {
  if (req.userRole !== 'admin' && req.userRole !== 'secretary') {
    return res.status(403).json({ error: 'Access denied. Admin or secretary rights required.' });
  }

  const { role } = req.query;
  try {
    const doctors = await prisma.doctor.findMany({
      where: role ? { role } : {},
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: {
          select: { appointments: true }
        }
      }
    });
    res.json(doctors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- ROUTES BELOW ARE STRICTLY ADMIN ONLY ---
router.use(admin);

// Create new doctor
router.post('/medicos', async (req, res) => {
  const { name, email, password, role } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedName) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const existing = await prisma.doctor.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const doctor = await prisma.doctor.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        password: hashedPassword,
        role: role || 'doctor'
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    });
    res.status(201).json(doctor);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Email already registered' });
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update doctor
router.put('/medicos/:id', async (req, res) => {
  const { name, email, role, password } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : name;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : email;

  if (name !== undefined && (typeof name !== 'string' || !normalizedName)) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (email !== undefined && !EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < 6)) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const data = {
      ...(normalizedName !== undefined && { name: normalizedName }),
      ...(normalizedEmail !== undefined && { email: normalizedEmail }),
      ...(role !== undefined && { role })
    };
    if (password) {
      data.password = await bcrypt.hash(password, 10);
    }

    const doctor = await prisma.doctor.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    });
    res.json(doctor);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Doctor not found' });
    if (err.code === 'P2002') return res.status(400).json({ error: 'Email already registered' });
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Delete doctor
router.delete('/medicos/:id', async (req, res) => {
  try {
    // Prevent self-deletion if needed
    if (req.params.id === req.doctorId) {
      return res.status(400).json({ error: 'You cannot delete yourself' });
    }

    await prisma.doctor.delete({
      where: { id: req.params.id }
    });
    res.json({ message: 'Doctor deleted successfully' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Doctor not found' });
    if (err.code === 'P2003') {
      return res.status(400).json({ error: 'Cannot delete a doctor with existing appointments or availability' });
    }
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Get reports (Appointments by doctor)
router.get('/reports/appointments-by-doctor', async (req, res) => {
  try {
    const report = await prisma.doctor.findMany({
      where: { role: 'doctor' },
      select: {
        name: true,
        _count: {
          select: { appointments: true }
        }
      }
    });

    const formatted = report.map(dr => ({
      doctor: dr.name,
      appointments: dr._count.appointments
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
