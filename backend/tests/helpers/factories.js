const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('./db');

let counter = 0;
const next = () => ++counter;

// The clinic the helpers use when a test does not ask for one, so the tests that
// do not care about clinics keep working inside a single one. (resetDb empties the
// table between tests, hence the lookup instead of a cached value.)
const DEFAULT_CLINIC_SLUG = 'test-clinic';

async function createClinic({ name, slug, ...rest } = {}) {
  const n = next();
  return prisma.clinic.create({
    data: { name: name || `Consultorio ${n}`, slug: slug || `consultorio-${n}`, ...rest }
  });
}

// Tests create several users at once, so two calls can both find nothing and try to
// create the clinic: the one that loses the race reads the winner's row.
async function defaultClinic() {
  const existing = await prisma.clinic.findUnique({ where: { slug: DEFAULT_CLINIC_SLUG } });
  if (existing) return existing;
  try {
    return await createClinic({ name: 'Consultorio de pruebas', slug: DEFAULT_CLINIC_SLUG });
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    return prisma.clinic.findUnique({ where: { slug: DEFAULT_CLINIC_SLUG } });
  }
}

const tokenFor = (doctor) => jwt.sign({ id: doctor.id, role: doctor.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

// Creates a user straight in the DB (low bcrypt cost keeps the suite fast) and
// returns it together with a valid token and the plain password. It belongs to
// `clinic` (a row from createClinic) or, by default, to the shared test clinic.
async function createUser({ role = 'doctor', name, email, password = 'secret123', clinic, ...rest } = {}) {
  const n = next();
  const user = await prisma.doctor.create({
    data: {
      name: name || `Dr Test ${n}`,
      email: email || `user${n}@example.test`,
      password: bcrypt.hashSync(password, 4),
      role,
      clinicId: (clinic || (await defaultClinic())).id,
      ...rest
    }
  });
  return { user, token: tokenFor(user), password };
}

// A patient of `clinic` (a row from createClinic) or, by default, of the shared test clinic.
async function createPatient({ clinic, ...overrides } = {}) {
  const n = next();
  return prisma.patient.create({
    data: {
      name: `Paciente ${n}`,
      phone: `+59390000${String(n).padStart(4, '0')}`,
      clinicId: (clinic || (await defaultClinic())).id,
      ...overrides
    }
  });
}

// An appointment of the doctor's clinic (the patient must belong to it too).
async function createAppointment({ doctor, patient, date, time, status = 'pending_approval', ...rest }) {
  return prisma.appointment.create({
    data: { doctorId: doctor.id, patientId: patient.id, clinicId: doctor.clinicId, date, time, status, ...rest }
  });
}

// A weekly schedule block of the doctor, in the doctor's clinic.
async function createAvailability({ doctor, dayOfWeek, startTime, endTime }) {
  return prisma.availability.create({
    data: { doctorId: doctor.id, clinicId: doctor.clinicId, dayOfWeek, startTime, endTime }
  });
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = {
  createClinic,
  defaultClinic,
  createUser,
  createPatient,
  createAppointment,
  createAvailability,
  tokenFor,
  bearer
};
