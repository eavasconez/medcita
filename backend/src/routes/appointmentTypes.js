const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const admin = require('../middleware/admin');
const { inClinic } = require('../utils/clinicScope');
const { recordAudit, diffFields, describeCreated } = require('../services/auditLog');
const types = require('../services/appointmentTypes');

const DURATION_MESSAGE = `durationMinutes must be a whole number of minutes between ${types.MIN_DURATION_MINUTES} and ${types.MAX_DURATION_MINUTES}, in steps of ${types.DURATION_STEP_MINUTES}`;
const NAME_MESSAGE = `name must be between ${types.MIN_NAME_LENGTH} and ${types.MAX_NAME_LENGTH} characters`;
const COLOR_MESSAGE = 'color must be a hex color like #0ea5e9';
const NAME_TAKEN = 'An appointment type with this name already exists';

const unexpected = (res, err, what) => {
  console.error(`${what} error:`, err);
  res.status(500).json({ error: 'An unexpected error occurred' });
};

// The clinic's types, the default one first. Everyone in the clinic can read them (booking
// needs them); archived ones only when an admin asks (?includeArchived=true), to manage them.
router.get('/', async (req, res) => {
  try {
    await types.ensureDefaultType(prisma, req.clinicId);
    const includeArchived = req.query.includeArchived === 'true' && req.userRole === 'admin';
    const list = await prisma.appointmentType.findMany({
      where: inClinic(req, includeArchived ? {} : { active: true }),
      select: types.TYPE_SELECT,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
    });
    res.json(list);
  } catch (err) {
    unexpected(res, err, 'List appointment types');
  }
});

// Add a type (admin)
router.post('/', admin, async (req, res) => {
  const name = types.normalizeName(req.body?.name);
  const { durationMinutes } = req.body || {};
  const color = req.body?.color ?? types.DEFAULT_TYPE.color;

  if (!types.isValidName(name)) return res.status(400).json({ error: NAME_MESSAGE });
  if (!types.isValidDuration(durationMinutes)) return res.status(400).json({ error: DURATION_MESSAGE });
  if (typeof color !== 'string' || !types.COLOR_REGEX.test(color)) return res.status(400).json({ error: COLOR_MESSAGE });

  try {
    const created = await prisma.$transaction(async (tx) => {
      await types.ensureDefaultType(tx, req.clinicId);
      if ((await tx.appointmentType.count({ where: inClinic(req) })) >= types.MAX_TYPES_PER_CLINIC) return null;
      const type = await tx.appointmentType.create({
        data: { clinicId: req.clinicId, name, durationMinutes, color: color.toLowerCase() },
        select: types.TYPE_SELECT
      });
      await recordAudit(tx, req, { action: 'create', entity: 'appointment_type', entityId: type.id, changes: describeCreated('appointment_type', type) });
      return type;
    });
    if (!created) return res.status(400).json({ error: `A clinic can have at most ${types.MAX_TYPES_PER_CLINIC} appointment types` });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: NAME_TAKEN });
    unexpected(res, err, 'Create appointment type');
  }
});

// Change a type's name, length, color, or archive / bring it back (admin). The length only
// applies to the appointments booked from then on: the ones already in the agenda keep theirs.
router.put('/:id', admin, async (req, res) => {
  const body = req.body || {};
  const data = {};

  if (body.name !== undefined) {
    const name = types.normalizeName(body.name);
    if (!types.isValidName(name)) return res.status(400).json({ error: NAME_MESSAGE });
    data.name = name;
  }
  if (body.durationMinutes !== undefined) {
    if (!types.isValidDuration(body.durationMinutes)) return res.status(400).json({ error: DURATION_MESSAGE });
    data.durationMinutes = body.durationMinutes;
  }
  if (body.color !== undefined) {
    if (typeof body.color !== 'string' || !types.COLOR_REGEX.test(body.color)) return res.status(400).json({ error: COLOR_MESSAGE });
    data.color = body.color.toLowerCase();
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return res.status(400).json({ error: 'active must be true or false' });
    data.active = body.active;
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Send at least one of: name, durationMinutes, color, active' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.appointmentType.findFirst({ where: inClinic(req, { id: req.params.id }), select: types.TYPE_SELECT });
      if (!current) return { status: 404, error: 'Appointment type not found' };
      if (current.isDefault && data.active === false) return { status: 400, error: 'The default appointment type cannot be archived' };

      const updated = await tx.appointmentType.update({ where: { id: current.id }, data, select: types.TYPE_SELECT });
      const changes = diffFields('appointment_type', current, updated);
      if (changes) await recordAudit(tx, req, { action: 'update', entity: 'appointment_type', entityId: current.id, changes });
      return { type: updated };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.type);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: NAME_TAKEN });
    unexpected(res, err, 'Update appointment type');
  }
});

// Archive a type (admin): it is no longer offered for new bookings, and the appointments that
// have it keep it. Archiving one that is already archived is fine. Bring it back with PUT.
router.delete('/:id', admin, async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.appointmentType.findFirst({ where: inClinic(req, { id: req.params.id }), select: types.TYPE_SELECT });
      if (!current) return { status: 404, error: 'Appointment type not found' };
      if (current.isDefault) return { status: 400, error: 'The default appointment type cannot be archived' };
      if (!current.active) return { type: current };

      const archived = await tx.appointmentType.update({ where: { id: current.id }, data: { active: false }, select: types.TYPE_SELECT });
      await recordAudit(tx, req, { action: 'update', entity: 'appointment_type', entityId: current.id, changes: diffFields('appointment_type', current, archived) });
      return { type: archived };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.type);
  } catch (err) {
    unexpected(res, err, 'Archive appointment type');
  }
});

module.exports = router;
