const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { inClinic, findDoctorInClinic } = require('../utils/clinicScope');
const { isValidDate, clinicDateString } = require('../utils/clinicTime');
const { recordAudit, describeCreated, describeRemoved } = require('../services/auditLog');
const blocks = require('../services/scheduleBlocks');
const { ecuadorHolidays } = require('../services/ecuadorHolidays');

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const isStaff = (req) => req.userRole === 'admin' || req.userRole === 'secretary';
const unexpected = (res, err, what) => {
  console.error(`${what} error:`, err);
  res.status(500).json({ error: 'An unexpected error occurred' });
};

// Blocks that close a doctor's agenda: their own and the clinic's. Without ?doctorId, staff
// see every block of the clinic; a doctor only ever sees the ones that touch them.
const visibleTo = (req, doctorId) => {
  if (!isStaff(req)) return { OR: [{ doctorId: null }, { doctorId: req.doctorId }] };
  return doctorId ? { OR: [{ doctorId: null }, { doctorId }] } : {};
};

// Ecuador's national holidays of a year, to pick from when blocking the clinic. A starting
// point, not an official calendar (see services/ecuadorHolidays.js): the person reviews them.
router.get('/holidays', (req, res) => {
  const year = req.query.year === undefined ? Number(clinicDateString(new Date(), req.clinicTimezone).slice(0, 4)) : Number(req.query.year);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return res.status(400).json({ error: `year must be a whole year between ${MIN_YEAR} and ${MAX_YEAR}` });
  }
  res.json({ year, holidays: ecuadorHolidays(year) });
});

// The blocks of the clinic that touch the days ?from..?to (both optional, inclusive), by date
router.get('/', async (req, res) => {
  const { from, to, doctorId } = req.query;
  if (from !== undefined && !isValidDate(from)) return res.status(400).json({ error: 'from must be a valid date (YYYY-MM-DD)' });
  if (to !== undefined && !isValidDate(to)) return res.status(400).json({ error: 'to must be a valid date (YYYY-MM-DD)' });
  if (from !== undefined && to !== undefined && from > to) return res.status(400).json({ error: 'from must not be after to' });
  if (doctorId !== undefined && (typeof doctorId !== 'string' || !doctorId)) return res.status(400).json({ error: 'doctorId must be an id' });

  try {
    const list = await prisma.scheduleBlock.findMany({
      where: inClinic(req, {
        AND: [visibleTo(req, doctorId), { ...(to && { startDate: { lte: to } }), ...(from && { endDate: { gte: from } }) }]
      }),
      select: blocks.BLOCK_SELECT,
      orderBy: [{ startDate: 'asc' }, { endDate: 'asc' }, { id: 'asc' }]
    });
    res.json(list.map(blocks.present));
  } catch (err) {
    unexpected(res, err, 'List schedule blocks');
  }
});

// Close a day or a range of days, for one doctor (`scope: "doctor"`, the default) or for the
// whole clinic (`scope: "clinic"`, staff only). A doctor blocks their own agenda; staff say whose
// with `doctorId`. Appointments already booked on those days are NOT cancelled: the answer lists
// them (`affectedAppointments`) so they can be moved.
router.post('/', async (req, res) => {
  const body = req.body || {};
  const { startDate } = body;
  const endDate = body.endDate ?? body.startDate;
  const reason = typeof body.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : '';
  const scope = body.scope ?? 'doctor';

  if (!isValidDate(startDate)) return res.status(400).json({ error: 'startDate must be a valid date (YYYY-MM-DD)' });
  if (!isValidDate(endDate)) return res.status(400).json({ error: 'endDate must be a valid date (YYYY-MM-DD)' });
  if (startDate > endDate) return res.status(400).json({ error: 'startDate must not be after endDate' });
  if (blocks.daysBetween(startDate, endDate) + 1 > blocks.MAX_RANGE_DAYS) {
    return res.status(400).json({ error: `A block can cover at most ${blocks.MAX_RANGE_DAYS} days` });
  }
  if (reason.length < blocks.MIN_REASON_LENGTH || reason.length > blocks.MAX_REASON_LENGTH) {
    return res.status(400).json({ error: `reason must be between ${blocks.MIN_REASON_LENGTH} and ${blocks.MAX_REASON_LENGTH} characters` });
  }
  if (scope !== 'doctor' && scope !== 'clinic') return res.status(400).json({ error: 'scope must be "doctor" or "clinic"' });
  if (endDate < clinicDateString(new Date(), req.clinicTimezone)) {
    return res.status(400).json({ error: 'A block cannot end in the past' });
  }

  let doctorId = null;
  if (scope === 'clinic') {
    if (!isStaff(req)) return res.status(403).json({ error: 'Only an admin or a secretary can block the whole clinic' });
  } else if (isStaff(req)) {
    if (typeof body.doctorId !== 'string' || !body.doctorId) return res.status(400).json({ error: 'doctorId is required to block a doctor\'s agenda' });
    doctorId = body.doctorId;
  } else {
    if (body.doctorId !== undefined && body.doctorId !== req.doctorId) return res.status(403).json({ error: 'You can only block your own agenda' });
    doctorId = req.doctorId;
  }

  try {
    if (doctorId && !(await findDoctorInClinic(prisma, req, doctorId))) return res.status(404).json({ error: 'Doctor not found' });

    const result = await prisma.$transaction(async (tx) => {
      if ((await tx.scheduleBlock.count({ where: inClinic(req) })) >= blocks.MAX_BLOCKS_PER_CLINIC) return null;
      const block = await tx.scheduleBlock.create({
        data: { clinicId: req.clinicId, doctorId, startDate, endDate, reason },
        select: blocks.BLOCK_SELECT
      });
      await recordAudit(tx, req, { action: 'create', entity: 'schedule_block', entityId: block.id, doctorId, changes: describeCreated('schedule_block', block) });
      return { block, ...(await blocks.appointmentsInBlock(tx, req, block)) };
    });
    if (!result) return res.status(400).json({ error: `A clinic can have at most ${blocks.MAX_BLOCKS_PER_CLINIC} blocks: delete the old ones` });

    res.status(201).json({ block: blocks.present(result.block), affectedTotal: result.total, affectedAppointments: result.appointments });
  } catch (err) {
    unexpected(res, err, 'Create schedule block');
  }
});

// A block the caller may touch: staff any of the clinic, a doctor only their own agenda's
const findManageable = (db, req) =>
  db.scheduleBlock.findFirst({
    where: inClinic(req, { id: req.params.id, ...(isStaff(req) ? {} : { OR: [{ doctorId: req.doctorId }, { doctorId: null }] }) }),
    select: blocks.BLOCK_SELECT
  });

// The appointments still on the books inside a block, to reschedule them (a doctor sees their own)
router.get('/:id/appointments', async (req, res) => {
  try {
    const block = await findManageable(prisma, req);
    if (!block) return res.status(404).json({ error: 'Schedule block not found' });
    const found = await blocks.appointmentsInBlock(prisma, req, block, { doctorId: isStaff(req) ? undefined : req.doctorId });
    res.json({ block: blocks.present(block), affectedTotal: found.total, affectedAppointments: found.appointments });
  } catch (err) {
    unexpected(res, err, 'List appointments of a schedule block');
  }
});

// Open the days again. Staff can remove any block; a doctor only their own (a clinic-wide one
// is not theirs to remove: 403).
router.delete('/:id', async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const block = await findManageable(tx, req);
      if (!block) return { status: 404, error: 'Schedule block not found' };
      if (!isStaff(req) && block.doctorId !== req.doctorId) return { status: 403, error: 'Only an admin or a secretary can remove a block of the whole clinic' };

      await tx.scheduleBlock.delete({ where: { id: block.id } });
      await recordAudit(tx, req, { action: 'delete', entity: 'schedule_block', entityId: block.id, doctorId: block.doctorId, changes: describeRemoved('schedule_block', block) });
      return { block };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ message: 'Schedule block removed', block: blocks.present(result.block) });
  } catch (err) {
    unexpected(res, err, 'Delete schedule block');
  }
});

module.exports = router;
