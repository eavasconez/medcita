const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const doctor = db.get('doctors').find({ email }).value();
    if (!doctor) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, doctor.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: doctor.id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: doctor.id, name: doctor.name, email: doctor.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
