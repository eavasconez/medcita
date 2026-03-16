const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const bcrypt = require('bcryptjs');

// Protect all routes with auth AND admin middleware
router.use(auth);
router.use(admin);

// List all doctors
router.get('/medicos', async (req, res) => {
  try {
    const doctors = await prisma.doctor.findMany({
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

// Create new doctor
router.post('/medicos', async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    const existing = await prisma.doctor.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email ya registrado' });

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
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }

    await prisma.doctor.delete({
      where: { id: req.params.id }
    });
    res.json({ message: 'Médico eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
