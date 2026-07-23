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

// Refuse to start with a missing, known-example, or too-short JWT secret -
// tokens signed with a guessable/checked-in secret can be forged by anyone
// who's read the repo, so this must be a hard failure, not a warning. The
// length check (rather than only an exact-match list) also catches any
// future example/placeholder value in .env.example without needing this
// list updated every time that placeholder changes.
const INSECURE_JWT_SECRETS = new Set(['demo_secret_key_123', 'replace_me_with_a_generated_secret']);
const MIN_JWT_SECRET_LENGTH = 32;
if (
  !process.env.JWT_SECRET ||
  INSECURE_JWT_SECRETS.has(process.env.JWT_SECRET) ||
  process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH
) {
  console.error(`FATAL: JWT_SECRET is missing, insecure, or shorter than ${MIN_JWT_SECRET_LENGTH} characters. Set a strong, unique secret in .env before starting the server.`);
  process.exit(1);
}

const app = express();

// Restrict CORS to known frontend origin(s) instead of allowing any origin.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim());
app.use(cors({ origin: allowedOrigins }));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Unauthenticated health check - gives uptime monitors (and any future
// platform health check) a stable 200 target that doesn't require a token,
// instead of them having to interpret a 401/404 from a real route as "down".
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

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

// Manual trigger for demo purpose - restricted to admin/secretary so any
// authenticated doctor can't fire off a system-wide notification batch.
app.post('/api/tasks/reminders', authMiddleware, async (req, res) => {
  if (req.userRole !== 'admin' && req.userRole !== 'secretary') {
    return res.status(403).json({ error: 'Forbidden' });
  }
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
