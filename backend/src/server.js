const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const db = require('./config/db');
const authRoutes = require('./routes/auth');
const appointmentRoutes = require('./routes/appointments');
const authMiddleware = require('./middleware/auth');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/appointments', authMiddleware, appointmentRoutes);

const PORT = process.env.PORT || 5000;

const seedData = async () => {
  // Solo crear datos de prueba si no hay doctores
  const doctors = db.get('doctors').value();
  if (doctors && doctors.length > 0) {
    console.log('Database already has data, skipping seed.');
    return;
  }

  const hashedPassword = await bcrypt.hash('demo1234', 10);
  const doctorId = uuidv4();
  
  db.get('doctors').push({
    id: doctorId,
    name: 'Dr. Santiago Pérez',
    email: 'demo@medcita.ec',
    password: hashedPassword
  }).write();

  const p1Id = uuidv4();
  const p2Id = uuidv4();

  db.get('patients').push({ id: p1Id, name: 'Juan Carlos Cevallos', phone: '+593987654321' }).write();
  db.get('patients').push({ id: p2Id, name: 'María Elena Lasso', phone: '+593900000001' }).write();

  db.get('appointments').push({ id: uuidv4(), date: '2026-03-15', time: '10:00', doctorId: doctorId, patientId: p1Id, status: 'scheduled' }).write();
  db.get('appointments').push({ id: uuidv4(), date: '2026-03-16', time: '14:30', doctorId: doctorId, patientId: p2Id, status: 'scheduled' }).write();

  console.log('Seed data created (Initial Setup)');
};

seedData().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
