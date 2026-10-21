const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('./db');

let counter = 0;
const next = () => ++counter;

const tokenFor = (doctor) => jwt.sign({ id: doctor.id, role: doctor.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

// Creates a user straight in the DB (low bcrypt cost keeps the suite fast) and
// returns it together with a valid token and the plain password.
async function createUser({ role = 'doctor', name, email, password = 'secret123', ...rest } = {}) {
  const n = next();
  const user = await prisma.doctor.create({
    data: {
      name: name || `Dr Test ${n}`,
      email: email || `user${n}@example.test`,
      password: bcrypt.hashSync(password, 4),
      role,
      ...rest
    }
  });
  return { user, token: tokenFor(user), password };
}

async function createPatient(overrides = {}) {
  const n = next();
  return prisma.patient.create({
    data: { name: `Paciente ${n}`, phone: `+59390000${String(n).padStart(4, '0')}`, ...overrides }
  });
}

async function createAppointment({ doctor, patient, date, time, status = 'pending_approval', ...rest }) {
  return prisma.appointment.create({
    data: { doctorId: doctor.id, patientId: patient.id, date, time, status, ...rest }
  });
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { createUser, createPatient, createAppointment, tokenFor, bearer };
