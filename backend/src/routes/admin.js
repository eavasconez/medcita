const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const bcrypt = require('bcryptjs');

// Protect all routes with authentication
router.use(auth);

// List all doctors (Accessible by Admin and Secretary)
router.get('/medicos', async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// --- ROUTES BELOW ARE STRICTLY ADMIN ONLY ---
router.use(admin);

// Create new doctor
router.post('/medicos', async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    const existing = await prisma.doctor.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const doctor = await prisma.doctor.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || 'doctor'
      }
    });
    res.status(201).json(doctor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update doctor
router.put('/medicos/:id', async (req, res) => {
  const { name, email, role, password } = req.body;
  try {
    const data = { name, email, role };
    if (password) {
      data.password = await bcrypt.hash(password, 10);
    }
    
    const doctor = await prisma.doctor.update({
      where: { id: req.params.id },
      data
    });
    res.json(doctor);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
