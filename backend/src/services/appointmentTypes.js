// The kinds of visit a clinic offers and what they mean for the agenda.
//
// Every clinic has exactly one default type (30 minutes, what every appointment was before
// types existed). The migration creates it for the clinics that already exist; for any
// other it is created the first time it is needed (`ensureDefaultType`), so no code path
// that creates a clinic has to remember it.

const DEFAULT_TYPE = { name: 'Consultation', durationMinutes: 30, color: '#0ea5e9' };

// A visit lasts between 5 minutes and 4 hours, in steps of 5 minutes
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 240;
const DURATION_STEP_MINUTES = 5;
const MAX_TYPES_PER_CLINIC = 30;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 40;
const COLOR_REGEX = /^#[0-9a-f]{6}$/i;

// What the API shows about a type, and what an appointment carries about its own
const TYPE_SELECT = { id: true, name: true, durationMinutes: true, color: true, isDefault: true, active: true };
const APPOINTMENT_TYPE_SELECT = { id: true, name: true, durationMinutes: true, color: true };

const isValidDuration = (value) =>
  Number.isInteger(value) && value >= MIN_DURATION_MINUTES && value <= MAX_DURATION_MINUTES && value % DURATION_STEP_MINUTES === 0;

const normalizeName = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
const isValidName = (name) => name.length >= MIN_NAME_LENGTH && name.length <= MAX_NAME_LENGTH;

// The clinic's default type. `db` is the Prisma client or a transaction client. Two requests
// can both find none and try to create it: the name is unique per clinic, so the one that
// loses reads the winner's row (a failed statement would abort a Postgres transaction, hence
// the upsert instead of a try/catch around create).
async function ensureDefaultType(db, clinicId) {
  const existing = await db.appointmentType.findFirst({ where: { clinicId, isDefault: true }, select: TYPE_SELECT });
  if (existing) return existing;
  return db.appointmentType.upsert({
    where: { clinicId_name: { clinicId, name: DEFAULT_TYPE.name } },
    create: { ...DEFAULT_TYPE, clinicId, isDefault: true },
    update: {},
    select: TYPE_SELECT
  });
}

// The type a booking uses: the clinic's default when none is asked for, otherwise an active
// type of that clinic. Null when the id is not one (another clinic's id looks the same as a
// made-up one).
async function resolveBookableType(db, clinicId, typeId) {
  if (typeId === undefined || typeId === null) return ensureDefaultType(db, clinicId);
  if (typeof typeId !== 'string' || !typeId) return null;
  return db.appointmentType.findFirst({ where: { id: typeId, clinicId, active: true }, select: TYPE_SELECT });
}

// 'HH:mm' as minutes since midnight
const toMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const toTimeString = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// Two visits clash when each starts before the other ends: back to back is fine.
const overlaps = (startA, durationA, startB, durationB) => startA < startB + durationB && startB < startA + durationA;

module.exports = {
  DEFAULT_TYPE,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  DURATION_STEP_MINUTES,
  MAX_TYPES_PER_CLINIC,
  MIN_NAME_LENGTH,
  MAX_NAME_LENGTH,
  COLOR_REGEX,
  TYPE_SELECT,
  APPOINTMENT_TYPE_SELECT,
  isValidDuration,
  normalizeName,
  isValidName,
  ensureDefaultType,
  resolveBookableType,
  toMinutes,
  toTimeString,
  overlaps
};
