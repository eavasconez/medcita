const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { addDays, format, parseISO } = require('date-fns');
const { parsePagination, pageInfo } = require('../utils/pagination');
const { isValidDate, isValidTimezone, appointmentInstant, clinicDateString } = require('../utils/clinicTime');
const { inClinic, findDoctorInClinic } = require('../utils/clinicScope');
const attendance = require('../services/attendanceReport');
const { inviteLimiter } = require('../middleware/rateLimiters');
const invitations = require('../services/invitationService');
const notificationLog = require('../services/notificationLog');
const { exposeLinks } = require('../utils/tokens');
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
const MAX_NAME_LENGTH = 100;
const MIN_CLINIC_NAME_LENGTH = 2;
const MAX_CLINIC_NAME_LENGTH = 80;
const PASSWORD_BY_OWNER = 'Passwords are chosen by each person: invite them (they pick it from the emailed link) or ask them to use "Forgot password".';

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

// List the clinic's doctors (Accessible by Admin and Secretary)
router.get(DOCTORS, async (req, res) => {
  if (req.userRole !== 'admin' && req.userRole !== 'secretary') {
    return res.status(403).json({ error: 'Access denied. Admin or secretary rights required.' });
  }

  const { role } = req.query;
  try {
    const doctors = await prisma.doctor.findMany({
      where: inClinic(req, role ? { role } : {}),
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

// Invite a person to the clinic. Nobody sets another person's password: the
// invitation emails them a single-use link where they choose their own, and the
// account exists from then on (see POST /api/auth/accept-invitation).
router.post(DOCTORS, inviteLimiter, async (req, res) => {
  const { name, email, role, password } = req.body || {};

  if (password !== undefined) return res.status(400).json({ error: PASSWORD_BY_OWNER });

  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedName) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (normalizedName.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: `Name must be at most ${MAX_NAME_LENGTH} characters` });
  }
  if (!EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > 254) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const result = await invitations.invite(req, { name: normalizedName, email: normalizedEmail, role: role || 'doctor' });
    res.status(201).json({
      ...result.invitation,
      delivered: result.delivered,
      ...(exposeLinks() && { devLink: result.url })
    });
  } catch (err) {
    if (err instanceof invitations.AlreadyMemberError) {
      return res.status(409).json({ error: 'This person already has an account in your clinic' });
    }
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Is the clinic's WhatsApp and email actually going out? For each channel: the run of
// failed messages since the last one that was sent, whether that is long enough to
// warn about (`failing`), and the last failure with its reason. Admins only.
router.get('/notification-status', async (req, res) => {
  try {
    res.json(await notificationLog.channelStatus(req.clinicId));
  } catch (err) {
    console.error('Notification status error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Pending invitations of the clinic
router.get('/invitations', async (req, res) => {
  try {
    res.json(await invitations.list(req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// New link (and a fresh week) for a pending invitation
router.post('/invitations/:id/resend', inviteLimiter, async (req, res) => {
  try {
    const result = await invitations.resend(req, req.params.id);
    if (!result) return res.status(404).json({ error: 'Invitation not found' });
    res.json({ ...result.invitation, delivered: result.delivered, ...(exposeLinks() && { devLink: result.url }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Cancel a pending invitation: its link stops working
router.delete('/invitations/:id', async (req, res) => {
  try {
    if (!(await invitations.revoke(req, req.params.id))) return res.status(404).json({ error: 'Invitation not found' });
    res.json({ message: 'Invitation cancelled successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Change the admin's own clinic: its name (what people see all over the app and in the
// invitations) and/or its timezone (how every appointment time is read). Send either or both.
router.put('/clinic', async (req, res) => {
  const { timezone } = req.body || {};
  const data = {};

  // A request without a name is only valid when it changes the timezone
  if (req.body?.name !== undefined || timezone === undefined) {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < MIN_CLINIC_NAME_LENGTH || name.length > MAX_CLINIC_NAME_LENGTH) {
      return res.status(400).json({ error: `Clinic name must be between ${MIN_CLINIC_NAME_LENGTH} and ${MAX_CLINIC_NAME_LENGTH} characters` });
    }
    data.name = name;
  }
  if (timezone !== undefined) {
    if (!isValidTimezone(timezone)) {
      return res.status(400).json({ error: 'timezone must be a valid IANA timezone (e.g. America/Guayaquil)' });
    }
    data.timezone = timezone;
  }

  try {
    const clinic = await prisma.clinic.update({
      where: { id: req.clinicId },
      data,
      select: { id: true, name: true, timezone: true }
    });
    res.json(clinic);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update doctor
router.put(DOCTOR, async (req, res) => {
  const { name, email, role, password } = req.body;

  if (password !== undefined) return res.status(400).json({ error: PASSWORD_BY_OWNER });

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

  try {
    const data = {
      ...(normalizedName !== undefined && { name: normalizedName }),
      ...(normalizedEmail !== undefined && { email: normalizedEmail }),
      ...(role !== undefined && { role })
    };

    const doctor = await prisma.$transaction(async (tx) => {
      const previous = await tx.doctor.findFirst({ where: inClinic(req, { id: req.params.id }) });
      if (!previous) return null;

      const updated = await tx.doctor.update({ where: { id: previous.id }, data });

      // Names and roles keep their before/after; the email only says that it changed
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
      const previous = await tx.doctor.findFirst({ where: inClinic(req, { id: req.params.id }) });
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
const dayStart = (date, timezone) => appointmentInstant(date, '00:00', timezone);
const nextDay = (date) => format(addDays(parseISO(date), 1), 'yyyy-MM-dd');

// What admins and secretaries of the clinic did, newest first, one page at a time. Filters:
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

  const where = inClinic(req, {
    ...(actorId && { actorId }),
    ...(entity && { entity }),
    ...(entityId && { entityId }),
    ...(action && { action }),
    ...(doctorId && { doctorId }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: dayStart(from, req.clinicTimezone) }),
        ...(to && { lt: dayStart(nextDay(to), req.clinicTimezone) })
      }
    })
  });

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
      ? await prisma.doctor.findMany({ where: inClinic(req, { id: { in: doctorIds } }), select: { id: true, name: true } })
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
        changes: row.changes,
        ip: row.ip,
        userAgent: row.userAgent
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
      where: inClinic(req, { role: 'doctor' }),
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

// The period of an attendance report: ?from and ?to (both included, 'YYYY-MM-DD' in the clinic's
// time); the whole current month when they are left out (its upcoming appointments are the ones
// still waiting for a confirmation). Returns { error } or { from, to, doctorId }.
function attendancePeriod(req) {
  const today = clinicDateString(new Date(), req.clinicTimezone);
  const [year, month] = today.split('-').map(Number);
  const from = req.query.from ?? `${today.slice(0, 7)}-01`;
  const to = req.query.to ?? `${today.slice(0, 7)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
  const { doctorId } = req.query;

  if (!isValidDate(from)) return { error: 'from must be a valid date (YYYY-MM-DD)' };
  if (!isValidDate(to)) return { error: 'to must be a valid date (YYYY-MM-DD)' };
  if (from > to) return { error: 'from must not be after to' };
  if (Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1 > attendance.MAX_RANGE_DAYS) {
    return { error: `The period can cover at most ${attendance.MAX_RANGE_DAYS} days` };
  }
  if (doctorId !== undefined && (typeof doctorId !== 'string' || !doctorId || doctorId.length > MAX_ID_LENGTH)) {
    return { error: 'doctorId must be an id' };
  }
  return { from, to, doctorId };
}

// Attendance of a period (S9-06): how many patients came, missed, cancelled or are still waiting,
// overall, by doctor and by type of visit, and who misses the most. Filters: from, to, doctorId.
router.get('/reports/attendance', async (req, res) => {
  const period = attendancePeriod(req);
  if (period.error) return res.status(400).json({ error: period.error });

  try {
    if (period.doctorId && !(await findDoctorInClinic(prisma, req, period.doctorId))) return res.status(404).json({ error: 'Doctor not found' });
    res.json(await attendance.attendanceReport(prisma, req, period));
  } catch (err) {
    console.error('Attendance report error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// The same report as a spreadsheet (CSV): counts for the whole period, per doctor and per type,
// never any patient's data.
router.get('/reports/attendance/export', async (req, res) => {
  const period = attendancePeriod(req);
  if (period.error) return res.status(400).json({ error: period.error });

  try {
    if (period.doctorId && !(await findDoctorInClinic(prisma, req, period.doctorId))) return res.status(404).json({ error: 'Doctor not found' });
    const report = await attendance.attendanceReport(prisma, req, period);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="attendance_${period.from}_${period.to}.csv"`,
      'Cache-Control': 'no-store'
    });
    res.send(attendance.attendanceCsv(report));
  } catch (err) {
    console.error('Attendance export error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
