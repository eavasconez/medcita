const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const bcrypt = require('bcryptjs');
const { addDays, format, parseISO } = require('date-fns');
const { parsePagination, pageInfo } = require('../utils/pagination');
const { isValidDate, appointmentInstant } = require('../utils/clinicTime');
const {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  recordAudit,
  diffFields,
  describeCreated,
  describeRemoved
} = require('../services/auditLog');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['admin', 'secretary', 'doctor'];

// Protect all routes with authentication
router.use(auth);

// /doctors used to be called /medicos. The old paths still work as an alias for
// clients that haven't been updated yet (e.g. a frontend still cached in a
// browser) and answer with a Deprecation header. Remove them once no client
// uses them.
const DOCTORS = ['/doctors', '/medicos'];
const DOCTOR = ['/doctors/:id', '/medicos/:id'];
router.use('/medicos', (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Link', '</api/admin/doctors>; rel="successor-version"');
  next();
});

// List all doctors (Accessible by Admin and Secretary)
router.get(DOCTORS, async (req, res) => {
  if (req.userRole !== 'admin' && req.userRole !== 'secretary') {
    return res.status(403).json({ error: 'Access denied. Admin or secretary rights required.' });
  }

  const { role } = req.query;
  try {
    const doctors = await prisma.doctor.findMany({
      where: role ? { role } : {},
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        // cancelled appointments stay in the database but are not counted
        _count: {
          select: { appointments: { where: { status: { not: 'cancelled' } } } }
        }
      }
    });
    res.json(doctors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- ROUTES BELOW ARE STRICTLY ADMIN ONLY ---
router.use(admin);

// Create new doctor
router.post(DOCTORS, async (req, res) => {
  const { name, email, password, role } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedName) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const existing = await prisma.doctor.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const doctor = await prisma.$transaction(async (tx) => {
      const created = await tx.doctor.create({
        data: {
          name: normalizedName,
          email: normalizedEmail,
          password: hashedPassword,
          role: role || 'doctor'
        },
        select: { id: true, name: true, email: true, role: true, createdAt: true }
      });
      await recordAudit(tx, req, {
        action: 'create',
        entity: 'user',
        entityId: created.id,
        changes: describeCreated('user', created)
      });
      return created;
    });
    res.status(201).json(doctor);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Email already registered' });
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update doctor
router.put(DOCTOR, async (req, res) => {
  const { name, email, role, password } = req.body;

  const normalizedName = typeof name === 'string' ? name.trim() : name;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : email;

  if (name !== undefined && (typeof name !== 'string' || !normalizedName)) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (email !== undefined && !EMAIL_REGEX.test(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < 6)) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const data = {
      ...(normalizedName !== undefined && { name: normalizedName }),
      ...(normalizedEmail !== undefined && { email: normalizedEmail }),
      ...(role !== undefined && { role })
    };
    if (password) {
      data.password = await bcrypt.hash(password, 10);
      // Sessions opened with the old password stop working
      data.passwordChangedAt = new Date();
    }

    const doctor = await prisma.$transaction(async (tx) => {
      const previous = await tx.doctor.findUnique({ where: { id: req.params.id } });
      if (!previous) return null;

      const updated = await tx.doctor.update({ where: { id: previous.id }, data });

      // Names and roles keep their before/after; email and password only say that they changed
      const changes = diffFields('user', previous, updated);
      if (changes) await recordAudit(tx, req, { action: 'update', entity: 'user', entityId: updated.id, changes });

      return { id: updated.id, name: updated.name, email: updated.email, role: updated.role, createdAt: updated.createdAt };
    });

    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
    res.json(doctor);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Doctor not found' });
    if (err.code === 'P2002') return res.status(400).json({ error: 'Email already registered' });
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Delete doctor
router.delete(DOCTOR, async (req, res) => {
  try {
    // Prevent self-deletion if needed
    if (req.params.id === req.doctorId) {
      return res.status(400).json({ error: 'You cannot delete yourself' });
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const previous = await tx.doctor.findUnique({ where: { id: req.params.id } });
      if (!previous) return false;

      await tx.doctor.delete({ where: { id: previous.id } });
      // The row is gone after this, so the entry keeps who it was (name and role)
      await recordAudit(tx, req, {
        action: 'delete',
        entity: 'user',
        entityId: previous.id,
        changes: describeRemoved('user', previous)
      });
      return true;
    });

    if (!deleted) return res.status(404).json({ error: 'Doctor not found' });
    res.json({ message: 'Doctor deleted successfully' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Doctor not found' });
    if (err.code === 'P2003') {
      return res.status(400).json({ error: 'Cannot delete a doctor with existing appointments or availability' });
    }
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

const AUDIT_DEFAULT_PAGE_SIZE = 50;
const AUDIT_MAX_PAGE_SIZE = 200;
const MAX_ID_LENGTH = 64;

const isBadId = (value) => value !== undefined && (typeof value !== 'string' || !value || value.length > MAX_ID_LENGTH);
// Clinic-local midnight of a 'YYYY-MM-DD' date, and the date after it
const dayStart = (date) => appointmentInstant(date, '00:00');
const nextDay = (date) => format(addDays(parseISO(date), 1), 'yyyy-MM-dd');

// What admins and secretaries did, newest first, one page at a time. Filters:
// from/to (clinic-local dates, both ends included), actorId (who did it),
// entity (appointment, patient or user), entityId, action and doctorId (the doctor
// whose agenda was affected). Read-only: nothing here updates or deletes entries.
router.get('/audit-log', async (req, res) => {
  const { from, to, actorId, entity, entityId, action, doctorId } = req.query;

  const paging = parsePagination(req.query, { defaultPageSize: AUDIT_DEFAULT_PAGE_SIZE, maxPageSize: AUDIT_MAX_PAGE_SIZE });
  if (paging.error) return res.status(400).json({ error: paging.error });
  const { page, pageSize, skip } = paging;

  if (from !== undefined && !isValidDate(from)) {
    return res.status(400).json({ error: 'from must be a valid date (YYYY-MM-DD)' });
  }
  if (to !== undefined && !isValidDate(to)) {
    return res.status(400).json({ error: 'to must be a valid date (YYYY-MM-DD)' });
  }
  if (from !== undefined && to !== undefined && from > to) {
    return res.status(400).json({ error: 'from must not be after to' });
  }
  if (entity !== undefined && !AUDIT_ENTITIES.includes(entity)) {
    return res.status(400).json({ error: `entity must be one of: ${AUDIT_ENTITIES.join(', ')}` });
  }
  if (action !== undefined && !AUDIT_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${AUDIT_ACTIONS.join(', ')}` });
  }
  for (const [name, value] of Object.entries({ actorId, entityId, doctorId })) {
    if (isBadId(value)) return res.status(400).json({ error: `${name} must be a non-empty text of at most ${MAX_ID_LENGTH} characters` });
  }

  const where = {
    ...(actorId && { actorId }),
    ...(entity && { entity }),
    ...(entityId && { entityId }),
    ...(action && { action }),
    ...(doctorId && { doctorId }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: dayStart(from) }),
        ...(to && { lt: dayStart(nextDay(to)) })
      }
    })
  };

  try {
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        // seq as the last key puts the entries of one transaction (they share a
        // timestamp) in the order they happened, and keeps the pages stable
        orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
        skip,
        take: pageSize
      }),
      prisma.auditLog.count({ where })
    ]);

    // Doctors are named from their account when it still exists (entries hold no foreign key)
    const doctorIds = [...new Set(rows.map((row) => row.doctorId).filter(Boolean))];
    const doctors = doctorIds.length
      ? await prisma.doctor.findMany({ where: { id: { in: doctorIds } }, select: { id: true, name: true } })
      : [];
    const doctorNames = new Map(doctors.map((doctor) => [doctor.id, doctor.name]));

    res.json({
      entries: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        actor: { id: row.actorId, name: row.actorName, role: row.actorRole },
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        doctor: row.doctorId ? { id: row.doctorId, name: doctorNames.get(row.doctorId) ?? null } : null,
        changes: row.changes
      })),
      ...pageInfo({ total, page, pageSize })
    });
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Diagnostic for the TRUST_PROXY setting: `ip` must be the caller's real public
// IP. If it shows a proxy address, raise TRUST_PROXY; if it shows an address the
// caller doesn't own, lower it (see config/trustProxy.js).
router.get('/client-ip', (req, res) => {
  res.json({
    ip: req.ip,
    forwardedFor: req.headers['x-forwarded-for'] || null,
    trustProxy: req.app.get('trust proxy')
  });
});

// Get reports (Appointments by doctor)
router.get('/reports/appointments-by-doctor', async (req, res) => {
  try {
    const report = await prisma.doctor.findMany({
      where: { role: 'doctor' },
      select: {
        name: true,
        _count: {
          select: { appointments: { where: { status: { not: 'cancelled' } } } }
        }
      }
    });

    const formatted = report.map(dr => ({
      doctor: dr.name,
      appointments: dr._count.appointments
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
