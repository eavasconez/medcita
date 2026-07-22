// MedCita Server
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const authRoutes = require('./routes/auth');
const appointmentRoutes = require('./routes/appointments');
const patientRoutes = require('./routes/patients');
const availabilityRoutes = require('./routes/availability');
const adminRoutes = require('./routes/admin');
const authMiddleware = require('./middleware/auth');
const cron = require('node-cron');
const { sendReminders } = require('./tasks/reminderTask');

const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/appointments', authMiddleware, appointmentRoutes);
app.use('/api/patients', authMiddleware, patientRoutes);
app.use('/api/availability', authMiddleware, availabilityRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);

// Cron Job for ~24h reminders (runs hourly so each appointment is
// reminded close to the 24h mark, not just "the day before")
cron.schedule('0 * * * *', () => {
  sendReminders().catch((error) => {
    console.error('Scheduled reminder task failed:', error.message);
  });
});

// Manual trigger for demo purpose
app.post('/api/tasks/reminders', authMiddleware, async (req, res) => {
  try {
    await sendReminders();
    res.json({ message: 'Reminders task triggered manually' });
  } catch (error) {
    res.status(500).json({ error: 'Reminders task failed' });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
