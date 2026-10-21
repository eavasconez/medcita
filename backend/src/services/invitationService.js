const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const notificationService = require('./notificationService');
const { recordAudit, recordAccountEvent, describeCreated, describeRemoved, diffFields } = require('./auditLog');
const { inClinic } = require('../utils/clinicScope');
const { TOKEN_PATTERN, newToken, hashToken, frontendLink, logDevLink } = require('../utils/tokens');

const INVITATION_TTL_DAYS = 7;
const BCRYPT_ROUNDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// Any link that is malformed, unknown, expired, already used or no longer valid
// (its email got an account in the meantime). Callers must not tell them apart.
class InvalidInvitationLinkError extends Error {}
// The person invited already belongs to the admin's own clinic (which the admin can
// see in their user list anyway, so saying so reveals nothing).
class AlreadyMemberError extends Error {}

// What the admin's screens need about an invitation (never the token or its hash).
const publicInvitation = (invitation) => ({
  id: invitation.id,
  name: invitation.name,
  email: invitation.email,
  role: invitation.role,
  invitedByName: invitation.invitedByName,
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
  expired: invitation.expiresAt <= new Date()
});

const newExpiry = () => new Date(Date.now() + INVITATION_TTL_DAYS * DAY_MS);

// Emails the link of an invitation. Resolves to whether an email was delivered.
async function sendInvitationEmail(invitation, clinicName, token) {
  const url = frontendLink('/accept-invitation', token);
  logDevLink('Invitation link', invitation.email, url);
  const delivered = await notificationService.sendInvitation({
    name: invitation.name,
    email: invitation.email,
    clinicName,
    invitedBy: invitation.invitedByName,
    role: invitation.role,
    url,
    expiresInDays: INVITATION_TTL_DAYS
  });
  return { delivered: Boolean(delivered), url };
}

async function clinicNameOf(clinicId) {
  return (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true } })).name;
}

/**
 * Invite a person (already validated and normalized) to the admin's clinic and email
 * them the link. Inviting someone who already has a pending invitation replaces it
 * (new link, new expiry, possibly another role). `req` is the admin's request: it
 * carries who is inviting and which clinic.
 *
 * An email that already has an account in ANOTHER clinic is invited like any other:
 * telling the admin would reveal who is registered elsewhere. That invitation simply
 * can not be accepted later.
 */
async function invite(req, { name, email, role }) {
  const member = await prisma.doctor.findFirst({ where: inClinic(req, { email }), select: { id: true } });
  if (member) throw new AlreadyMemberError();

  const token = newToken();
  const data = {
    tokenHash: hashToken(token),
    name,
    role,
    expiresAt: newExpiry(),
    invitedById: req.doctorId,
    invitedByName: req.userName
  };

  const invitation = await prisma.$transaction(async (tx) => {
    const previous = await tx.invitation.findUnique({ where: { clinicId_email: { clinicId: req.clinicId, email } } });
    const saved = previous
      ? await tx.invitation.update({ where: { id: previous.id }, data })
      : await tx.invitation.create({ data: { ...data, email, clinicId: req.clinicId } });
    await recordAudit(tx, req, {
      action: previous ? 'update' : 'create',
      entity: 'invitation',
      entityId: saved.id,
      changes: previous ? diffFields('invitation', previous, saved) : describeCreated('invitation', saved)
    });
    return saved;
  });

  const { delivered, url } = await sendInvitationEmail(invitation, await clinicNameOf(req.clinicId), token);
  return { invitation: publicInvitation(invitation), delivered, url };
}

// The clinic's invitations, newest first
async function list(req) {
  const invitations = await prisma.invitation.findMany({
    where: inClinic(req),
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
  });
  return invitations.map(publicInvitation);
}

// New link and a fresh week for an invitation of the admin's clinic; null if there is no such one.
async function resend(req, id) {
  const token = newToken();
  const invitation = await prisma.$transaction(async (tx) => {
    const found = await tx.invitation.findFirst({ where: inClinic(req, { id }) });
    if (!found) return null;
    return tx.invitation.update({
      where: { id: found.id },
      data: { tokenHash: hashToken(token), expiresAt: newExpiry() }
    });
  });
  if (!invitation) return null;

  const { delivered, url } = await sendInvitationEmail(invitation, await clinicNameOf(req.clinicId), token);
  return { invitation: publicInvitation(invitation), delivered, url };
}

// Cancels an invitation of the admin's clinic; false if there is no such one.
async function revoke(req, id) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.invitation.findFirst({ where: inClinic(req, { id }) });
    if (!found) return false;
    await tx.invitation.delete({ where: { id: found.id } });
    await recordAudit(tx, req, {
      action: 'delete',
      entity: 'invitation',
      entityId: found.id,
      changes: describeRemoved('invitation', found)
    });
    return true;
  });
}

// The invitation behind a link that is still valid, with its clinic.
async function findValid(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new InvalidInvitationLinkError();
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { clinic: { select: { id: true, name: true } } }
  });
  if (!invitation || invitation.expiresAt <= new Date()) throw new InvalidInvitationLinkError();
  return invitation;
}

// What a person is shown before choosing a password: where they are being invited.
async function preview(token) {
  const invitation = await findValid(token);
  return {
    clinicName: invitation.clinic.name,
    name: invitation.name,
    email: invitation.email,
    role: invitation.role,
    invitedByName: invitation.invitedByName
  };
}

/**
 * Accept an invitation: creates the account in the clinic that invited, with the
 * password chosen now, and consumes the link. Resolves to the new account, with its
 * clinic.
 */
async function accept(token, password, req) {
  const invitation = await findValid(token);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    return await prisma.$transaction(async (tx) => {
      // Deleting and counting is what makes the link single use even when two
      // requests race: only one of them can delete the row.
      const claimed = await tx.invitation.deleteMany({ where: { id: invitation.id, expiresAt: { gt: new Date() } } });
      if (claimed.count !== 1) throw new InvalidInvitationLinkError();

      const account = await tx.doctor.create({
        data: {
          clinicId: invitation.clinicId,
          name: invitation.name,
          email: invitation.email,
          role: invitation.role,
          password: passwordHash
        },
        include: { clinic: { select: { id: true, name: true } } }
      });
      // The link signs the new account in
      await recordAccountEvent(tx, req, account, 'login');
      return account;
    });
  } catch (err) {
    // The email got an account in another clinic after the invitation was sent
    if (err.code === 'P2002') throw new InvalidInvitationLinkError();
    throw err;
  }
}

module.exports = {
  INVITATION_TTL_DAYS,
  InvalidInvitationLinkError,
  AlreadyMemberError,
  invite,
  list,
  resend,
  revoke,
  preview,
  accept
};
