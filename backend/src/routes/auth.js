const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const {
  loginIpLimiter,
  loginEmailLimiter,
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  resetPasswordIpLimiter,
  changePasswordLimiter,
  registerIpLimiter,
  registerEmailLimiter,
  accountLinkIpLimiter,
  clearLoginAttempts
} = require('../middleware/rateLimiters');
const passwordReset = require('../services/passwordResetService');
const signup = require('../services/signupService');
const invitations = require('../services/invitationService');
const { exposeLinks } = require('../utils/tokens');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
const FORGOT_PASSWORD_MESSAGE = 'If an account exists for that email, we have sent a link to reset the password.';
// Machine-readable, so the UI can tell this apart from a validation error without matching text.
const INVALID_RESET_LINK_CODE = 'INVALID_RESET_LINK';
const INVALID_RESET_LINK_MESSAGE = 'This password reset link is invalid or has expired. Please request a new one.';
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-attack-mitigation', 10);

const CLINIC_SELECT = { id: true, name: true };
const MAX_NAME_LENGTH = 100;
const MAX_CLINIC_NAME_LENGTH = 80;
const MIN_CLINIC_NAME_LENGTH = 2;
const REGISTER_MESSAGE = 'Check your email: we have sent a link to confirm your account.';
// Machine-readable, so the UI can tell a dead link apart from a validation error.
const INVALID_LINK_CODE = 'INVALID_LINK';
const INVALID_INVITATION_MESSAGE = 'This invitation link is invalid or has expired. Ask your clinic admin to send you a new one.';
const INVALID_SIGNUP_LINK_MESSAGE = 'This confirmation link is invalid or has expired. Please sign up again.';

// Fields safe to expose about the authenticated user (never the password hash)
const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  specialty: true,
  bio: true,
  address: true,
  createdAt: true,
  clinic: { select: CLINIC_SELECT },
  _count: { select: { appointments: true } }
};

// What the frontend keeps about a signed-in user. `doctor` must carry its clinic.
const sessionUser = (doctor) => ({
  id: doctor.id,
  name: doctor.name,
  email: doctor.email,
  role: doctor.role,
  clinic: doctor.clinic
});

// Ask for a new clinic and its first admin. Nothing is created until the person
// confirms their email with the link we send (see /verify-email). The answer is the
// same whether or not the email already has an account, and it is sent BEFORE the
// account is even looked up (that happens in the background), so neither its
// content nor its response time reveals which emails are registered.
router.post('/register', registerIpLimiter, registerEmailLimiter, async (req, res) => {
  const { name, email, password, clinicName } = req.body || {};

  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const normalizedClinicName = typeof clinicName === 'string' ? clinicName.trim().replace(/\s+/g, ' ') : '';

  if (!normalizedName) return res.status(400).json({ error: 'Name is required' });
  if (normalizedName.length > MAX_NAME_LENGTH) return res.status(400).json({ error: `Name must be at most ${MAX_NAME_LENGTH} characters` });
  if (!EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > 254) return res.status(400).json({ error: 'A valid email is required' });
  if (normalizedClinicName.length < MIN_CLINIC_NAME_LENGTH || normalizedClinicName.length > MAX_CLINIC_NAME_LENGTH) {
    return res.status(400).json({ error: `Clinic name must be between ${MIN_CLINIC_NAME_LENGTH} and ${MAX_CLINIC_NAME_LENGTH} characters` });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: PASSWORD_TOO_SHORT });

  const details = { name: normalizedName, email: normalizedEmail, password, clinicName: normalizedClinicName };

  // QA mode (never on a hosted service): wait for the work and hand back the link
  if (exposeLinks()) {
    try {
      const result = await signup.requestSignup(details);
      return res.status(202).json({ message: REGISTER_MESSAGE, ...(result && { devLink: result.url }) });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'An unexpected error occurred' });
    }
  }

  res.status(202).json({ message: REGISTER_MESSAGE });
  signup.requestSignupInBackground(details);
});

// Confirm the email of a sign-up: creates the clinic and its admin, and signs the
// admin in. A link works once.
router.post('/verify-email', accountLinkIpLimiter, async (req, res) => {
  try {
    const doctor = await signup.confirmSignup(req.body?.token);
    const token = jwt.sign({ id: doctor.id, role: doctor.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.status(201).json({ token, user: sessionUser(doctor) });
  } catch (err) {
    if (err instanceof signup.InvalidSignupLinkError) {
      return res.status(400).json({ error: INVALID_SIGNUP_LINK_MESSAGE, code: INVALID_LINK_CODE });
    }
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Where an emailed invitation leads: the clinic that invited the person and the role,
// so the page can say so before asking for a password. The token travels in the body,
// not the URL, so it stays out of the access logs.
router.post('/invitation-preview', accountLinkIpLimiter, async (req, res) => {
  try {
    res.json(await invitations.preview(req.body?.token));
  } catch (err) {
    if (err instanceof invitations.InvalidInvitationLinkError) {
      return res.status(400).json({ error: INVALID_INVITATION_MESSAGE, code: INVALID_LINK_CODE });
    }
    console.error('Invitation preview error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Accept an invitation: the person chooses their password, the account is created in
// the clinic that invited them and they are signed in. A link works once.
router.post('/accept-invitation', accountLinkIpLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: PASSWORD_TOO_SHORT });
  }

  try {
    const doctor = await invitations.accept(token, password);
    const sessionToken = jwt.sign({ id: doctor.id, role: doctor.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.status(201).json({ token: sessionToken, user: sessionUser(doctor) });
  } catch (err) {
    if (err instanceof invitations.InvalidInvitationLinkError) {
      return res.status(400).json({ error: INVALID_INVITATION_MESSAGE, code: INVALID_LINK_CODE });
    }
    console.error('Accept invitation error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Failed attempts are rate limited per IP and per account (see rateLimiters.js).
router.post('/login', loginIpLimiter, loginEmailLimiter, async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const doctor = await prisma.doctor.findUnique({
      where: { email: normalizedEmail },
      include: { clinic: { select: CLINIC_SELECT } }
    });
    const isMatch = await bcrypt.compare(password, doctor ? doctor.password : DUMMY_PASSWORD_HASH);
    if (!doctor || !isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: doctor.id, role: doctor.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: sessionUser(doctor) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Ask for a password reset link. The answer is always the same and is sent BEFORE
// the account is even looked up (that happens in the background), so neither its
// content nor its response time reveals whether an email has an account.
router.post('/forgot-password', forgotPasswordIpLimiter, forgotPasswordEmailLimiter, (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'A valid email is required' });

  res.json({ message: FORGOT_PASSWORD_MESSAGE });
  passwordReset.requestPasswordResetInBackground(email);
});

// Set a new password with the single-use token from the emailed link.
router.post('/reset-password', resetPasswordIpLimiter, async (req, res) => {
  const { token, password } = req.body || {};

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: PASSWORD_TOO_SHORT });
  }

  try {
    const doctor = await passwordReset.resetPassword(token, password);
    await clearLoginAttempts(doctor.email);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    if (err instanceof passwordReset.InvalidResetTokenError) {
      return res.status(400).json({ error: INVALID_RESET_LINK_MESSAGE, code: INVALID_RESET_LINK_CODE });
    }
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Change the password of the signed-in account. Every other session (any token
// issued before now) stops working; the answer carries a fresh token so this one
// keeps going. A wrong current password is a 403, not a 401: the frontend treats
// any 401 as "session expired" and would sign the user out for a typo.
router.post('/change-password', auth, changePasswordLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (typeof currentPassword !== 'string' || !currentPassword) {
    return res.status(400).json({ error: 'Current password is required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: PASSWORD_TOO_SHORT });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'The new password must be different from the current one' });
  }

  try {
    const doctor = await prisma.doctor.findUnique({
      where: { id: req.doctorId },
      include: { clinic: { select: CLINIC_SELECT } }
    });
    if (!doctor) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, doctor.password);
    if (!isMatch) return res.status(403).json({ error: 'Current password is incorrect' });

    await prisma.doctor.update({
      where: { id: doctor.id },
      data: { password: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date() }
    });

    const token = jwt.sign({ id: doctor.id, role: doctor.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({
      message: 'Password updated successfully',
      token,
      user: sessionUser(doctor)
    });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Get the authenticated user's own profile
router.get('/profile', auth, async (req, res) => {
  try {
    const doctor = await prisma.doctor.findUnique({
      where: { id: req.doctorId },
      select: PROFILE_SELECT
    });
    if (!doctor) return res.status(404).json({ error: 'User not found' });
    res.json(doctor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update the authenticated user's own profile (self-service: name/specialty/bio only)
router.put('/profile', auth, async (req, res) => {
  // Guard against a bodyless request or a literal JSON null, which would throw
  // on destructuring and surface as an uncontrolled 500 instead of a 400.
  const { name, specialty, bio, address } = req.body || {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
  }
  if (specialty !== undefined && specialty !== null && typeof specialty !== 'string') {
    return res.status(400).json({ error: 'Specialty must be a string' });
  }
  if (bio !== undefined && bio !== null && typeof bio !== 'string') {
    return res.status(400).json({ error: 'Bio must be a string' });
  }
  if (address !== undefined && address !== null && typeof address !== 'string') {
    return res.status(400).json({ error: 'Address must be a string' });
  }

  const data = {};
  if (name !== undefined) data.name = name.trim();
  // Empty string clears the field (stored as null) instead of a blank value
  if (specialty !== undefined) {
    const trimmed = typeof specialty === 'string' ? specialty.trim() : specialty;
    data.specialty = trimmed ? trimmed : null;
  }
  if (bio !== undefined) {
    const trimmed = typeof bio === 'string' ? bio.trim() : bio;
    data.bio = trimmed ? trimmed : null;
  }
  if (address !== undefined) {
    const trimmed = typeof address === 'string' ? address.trim() : address;
    data.address = trimmed ? trimmed : null;
  }

  try {
    const doctor = await prisma.doctor.update({
      where: { id: req.doctorId },
      data,
      select: PROFILE_SELECT
    });
    res.json(doctor);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
