// Days nobody attends (S9-05): a doctor's vacation, a congress, a national holiday. A block
// covers whole days, `startDate` to `endDate` both included, for one doctor or, with no
// doctor, for the whole clinic.

const { inClinic } = require('../utils/clinicScope');

const MIN_REASON_LENGTH = 2;
const MAX_REASON_LENGTH = 120;
const MAX_RANGE_DAYS = 366;
const MAX_BLOCKS_PER_CLINIC = 500;
// The appointments a new block lands on are listed to be rescheduled; this many at most
const MAX_AFFECTED_LISTED = 200;

const BLOCK_SELECT = { id: true, doctorId: true, startDate: true, endDate: true, reason: true, createdAt: true, doctor: { select: { name: true } } };

// What the API shows about a block: `scope` says whose agenda it closes
const present = (block) => ({
  id: block.id,
  scope: block.doctorId ? 'doctor' : 'clinic',
  doctorId: block.doctorId,
  doctorName: block.doctor?.name ?? null,
  startDate: block.startDate,
  endDate: block.endDate,
  reason: block.reason,
  createdAt: block.createdAt
});

// The block (if any) that closes `date` for the doctor: one of theirs or one of the whole
// clinic. Dates are 'YYYY-MM-DD' text, so comparing them as text is comparing days.
// `db` is the Prisma client or a transaction client.
const findBlockOn = (db, { clinicId, doctorId, date }) =>
  db.scheduleBlock.findFirst({
    where: { clinicId, startDate: { lte: date }, endDate: { gte: date }, OR: [{ doctorId: null }, { doctorId }] },
    select: BLOCK_SELECT
  });

// Whole days between two 'YYYY-MM-DD' dates (end minus start)
const daysBetween = (start, end) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / (24 * 60 * 60 * 1000));

// The appointments still on the books inside a block, oldest first, so they can be moved.
// `doctorId` limits it to one doctor (a doctor only sees their own).
async function appointmentsInBlock(db, req, block, { doctorId } = {}) {
  const where = inClinic(req, {
    date: { gte: block.startDate, lte: block.endDate },
    status: { not: 'cancelled' },
    ...(block.doctorId || doctorId ? { doctorId: block.doctorId || doctorId } : {})
  });
  const [total, appointments] = await Promise.all([
    db.appointment.count({ where }),
    db.appointment.findMany({
      where,
      select: {
        id: true, date: true, time: true, status: true,
        patient: { select: { id: true, name: true, phone: true } },
        doctor: { select: { id: true, name: true } }
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
      take: MAX_AFFECTED_LISTED
    })
  ]);
  return { total, appointments };
}

module.exports = {
  MIN_REASON_LENGTH,
  MAX_REASON_LENGTH,
  MAX_RANGE_DAYS,
  MAX_BLOCKS_PER_CLINIC,
  BLOCK_SELECT,
  present,
  findBlockOn,
  daysBetween,
  appointmentsInBlock
};
