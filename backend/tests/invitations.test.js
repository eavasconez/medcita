const crypto = require('crypto');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const { INVITATION_TTL_DAYS } = require('../src/services/invitationService');
const { hashToken } = require('../src/utils/tokens');
const { LIMITS } = require('../src/middleware/rateLimiters');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, bearer } = require('./helpers/factories');
const { stubNotifications } = require('./helpers/notifications');

const notifications = stubNotifications();

beforeEach(async () => {
  await resetDb();
  notifications.clear();
});

afterAll(async () => {
  notifications.restore();
  await prisma.$disconnect();
});

const DAY = 24 * 60 * 60 * 1000;
const INVALID_LINK_CODE = 'INVALID_LINK';
const TOKEN_IN_TEXT = /accept-invitation\?token=([A-Za-z0-9_-]{43})/;

const invite = (token, body) => request(app).post('/api/admin/doctors').set(bearer(token)).send(body);
const list = (token) => request(app).get('/api/admin/invitations').set(bearer(token));
const resend = (token, id) => request(app).post(`/api/admin/invitations/${id}/resend`).set(bearer(token));
const revoke = (token, id) => request(app).delete(`/api/admin/invitations/${id}`).set(bearer(token));
const preview = (token) => request(app).post('/api/auth/invitation-preview').send({ token });
const accept = (token, password = 'secret123') => request(app).post('/api/auth/accept-invitation').send({ token, password });

const emailsTo = (to) => notifications.sent.filter((m) => m.channel === 'email' && m.to === to);
const lastTokenSentTo = (to) => {
  const mails = emailsTo(to);
  return mails[mails.length - 1].text.match(TOKEN_IN_TEXT)[1];
};

// An admin of a clinic called "Consultorio Torres" and the invitation they send
async function adminAndInvitation(body = { name: 'Marta Secretaria', email: 'marta@example.test', role: 'secretary' }) {
  const clinic = await createClinic({ name: 'Consultorio Torres', slug: 'consultorio-torres' });
  const admin = await createUser({ role: 'admin', clinic, name: 'Dra. Ana Torres' });
  const res = await invite(admin.token, body);
  expect(res.status).toBe(201);
  return { clinic, admin, invitation: res.body, token: lastTokenSentTo(body.email) };
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const storeInvitation = (clinic, token, overrides = {}) =>
  prisma.invitation.create({
    data: {
      tokenHash: hashToken(token),
      name: 'Dr. Guardado',
      email: 'guardado@example.test',
      role: 'doctor',
      expiresAt: new Date(Date.now() + DAY),
      invitedById: 'someone',
      invitedByName: 'Alguien',
      clinicId: clinic.id,
      ...overrides
    }
  });

describe('inviting a person', () => {
  it('emails them a link that names the clinic and who invited them, valid for a week', async () => {
    const { invitation, token } = await adminAndInvitation();

    const [mail] = emailsTo('marta@example.test');
    expect(mail.subject).toBe('Dra. Ana Torres te invitó a Consultorio Torres - MedCita');
    expect(mail.text).toContain('Consultorio Torres');
    expect(mail.text).toContain(`${INVITATION_TTL_DAYS} días`);
    expect(mail.html).toContain('Consultorio Torres');
    expect(mail.html).toContain('secretario/a');
    expect(invitation).toMatchObject({ name: 'Marta Secretaria', email: 'marta@example.test', role: 'secretary', invitedByName: 'Dra. Ana Torres', delivered: true, expired: false });
    expect(new Date(invitation.expiresAt).getTime() - Date.now()).toBeGreaterThan((INVITATION_TTL_DAYS - 0.01) * DAY);
    expect(token).toHaveLength(43);
  });

  it('keeps only the hash of the link, and creates no account yet', async () => {
    const { admin, invitation, token } = await adminAndInvitation();

    const stored = await prisma.invitation.findUnique({ where: { id: invitation.id } });
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify(invitation)).not.toMatch(/tokenHash|devLink/);
    expect(await prisma.doctor.count({ where: { email: 'marta@example.test' } })).toBe(0);
    expect(stored.invitedById).toBe(admin.user.id);
  });

  it('replaces the earlier invitation for the same email: one row, new link, the new role', async () => {
    const { admin, token: first } = await adminAndInvitation();

    const again = await invite(admin.token, { name: 'Marta S.', email: 'MARTA@example.test', role: 'doctor' });
    const second = lastTokenSentTo('marta@example.test');

    expect(again.status).toBe(201);
    expect(await prisma.invitation.count()).toBe(1);
    expect((await accept(first)).status).toBe(400);
    const accepted = await accept(second);
    expect(accepted.status).toBe(201);
    expect(accepted.body.user).toMatchObject({ name: 'Marta S.', role: 'doctor' });
  });

  it('is answered the same when the email has an account in another clinic, so nothing is revealed', async () => {
    const { admin } = await adminAndInvitation();
    await createUser({ email: 'elsewhere@example.test' }); // another clinic's account

    const known = await invite(admin.token, { name: 'Alguien', email: 'elsewhere@example.test' });
    const unknown = await invite(admin.token, { name: 'Alguien', email: 'ghost@example.test' });

    expect(known.status).toBe(201);
    expect(unknown.status).toBe(201);
    expect(Object.keys(known.body)).toEqual(Object.keys(unknown.body));
    expect(known.body.delivered).toBe(unknown.body.delivered);
  });

  it('cannot be accepted when the email got an account elsewhere in the meantime, and creates nothing', async () => {
    const { admin } = await adminAndInvitation();
    await invite(admin.token, { name: 'Alguien', email: 'elsewhere@example.test' });
    const token = lastTokenSentTo('elsewhere@example.test');
    await createUser({ email: 'elsewhere@example.test' });

    const res = await accept(token);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(INVALID_LINK_CODE);
    expect(await prisma.doctor.count({ where: { email: 'elsewhere@example.test' } })).toBe(1);
  });

  it('lets two clinics invite the same email, each with its own invitation', async () => {
    const { admin } = await adminAndInvitation();
    const otherAdmin = await createUser({ role: 'admin', clinic: await createClinic({ name: 'Otra Clínica' }) });

    await invite(otherAdmin.token, { name: 'Marta', email: 'marta@example.test' });

    expect(await prisma.invitation.count({ where: { email: 'marta@example.test' } })).toBe(2);
    expect((await list(admin.token)).body).toHaveLength(1);
  });

  it('limits how many invitations an admin can send per hour', async () => {
    const admin = await createUser({ role: 'admin' });

    for (let i = 0; i < LIMITS.invitePerAdmin.limit; i++) {
      expect((await invite(admin.token, { name: 'Persona', email: `persona${i}@example.test` })).status).toBe(201);
    }
    const res = await invite(admin.token, { name: 'Una más', email: 'una-mas@example.test' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/^Too many invitations sent/);
    expect((await invite((await createUser({ role: 'admin' })).token, { name: 'Otro', email: 'otro@example.test' })).status).toBe(201);
  });
});

describe('the invitations of a clinic', () => {
  it('are listed for the admin only, newest first, without any link', async () => {
    const { admin, clinic } = await adminAndInvitation();
    await invite(admin.token, { name: 'Segundo', email: 'segundo@example.test' });
    await storeInvitation(clinic, newToken(), { email: 'vieja@example.test', createdAt: new Date(Date.now() - 10 * DAY), expiresAt: new Date(Date.now() - 3 * DAY) });
    const secretary = await createUser({ role: 'secretary', clinic });

    const res = await list(admin.token);

    expect(res.status).toBe(200);
    expect(res.body.map((i) => i.email)).toEqual(['segundo@example.test', 'marta@example.test', 'vieja@example.test']);
    expect(res.body.map((i) => i.expired)).toEqual([false, false, true]);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    expect((await list(secretary.token)).status).toBe(403);
    expect((await request(app).get('/api/admin/invitations')).status).toBe(401);
  });

  it('can be resent: a new link replaces the old one and the week starts again', async () => {
    const { admin, clinic, invitation, token: oldToken } = await adminAndInvitation();
    await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() + DAY) } });
    notifications.clear();

    const res = await resend(admin.token, invitation.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: invitation.id, delivered: true });
    expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeGreaterThan((INVITATION_TTL_DAYS - 0.01) * DAY);
    expect(emailsTo('marta@example.test')).toHaveLength(1);
    expect((await accept(oldToken)).status).toBe(400);
    expect((await accept(lastTokenSentTo('marta@example.test'))).status).toBe(201);
    expect((await prisma.doctor.findUnique({ where: { email: 'marta@example.test' } })).clinicId).toBe(clinic.id);
  });

  it('can be cancelled: the link stops working', async () => {
    const { admin, invitation, token } = await adminAndInvitation();

    const res = await revoke(admin.token, invitation.id);

    expect(res.status).toBe(200);
    expect(await prisma.invitation.count()).toBe(0);
    expect((await accept(token)).status).toBe(400);
    expect((await revoke(admin.token, invitation.id)).status).toBe(404);
  });

  it('are invisible to the admin of another clinic: not listed, not resent, not cancelled', async () => {
    const { invitation } = await adminAndInvitation();
    const other = await createUser({ role: 'admin', clinic: await createClinic({ name: 'Otra Clínica' }) });

    expect((await list(other.token)).body).toEqual([]);
    expect((await resend(other.token, invitation.id)).status).toBe(404);
    expect((await revoke(other.token, invitation.id)).status).toBe(404);
    expect(await prisma.invitation.count()).toBe(1);
    expect(emailsTo('marta@example.test')).toHaveLength(1);
  });
});

describe('POST /api/auth/invitation-preview', () => {
  it('tells where the person is being invited, before they choose a password', async () => {
    const { token } = await adminAndInvitation();

    const res = await preview(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      clinicName: 'Consultorio Torres',
      name: 'Marta Secretaria',
      email: 'marta@example.test',
      role: 'secretary',
      invitedByName: 'Dra. Ana Torres'
    });
    expect(await prisma.invitation.count()).toBe(1); // looking does not use it up
  });

  it('answers the same 400 for an unknown, malformed, missing or expired link', async () => {
    const { clinic } = await adminAndInvitation();
    const expired = newToken();
    await storeInvitation(clinic, expired, { expiresAt: new Date(Date.now() - 1000) });

    const answers = [];
    for (const token of [newToken(), 'not-a-token', undefined, expired]) answers.push(await preview(token));

    for (const res of answers) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual(answers[0].body);
    }
    expect(answers[0].body.code).toBe(INVALID_LINK_CODE);
  });

  it('limits failed attempts per IP', async () => {
    for (let i = 0; i < LIMITS.accountLinkPerIp.limit; i++) expect((await preview(newToken())).status).toBe(400);

    expect((await preview(newToken())).status).toBe(429);
  });
});

describe('POST /api/auth/accept-invitation', () => {
  it('creates the account in the clinic that invited, with the role and the chosen password, and signs in', async () => {
    const { clinic, token } = await adminAndInvitation();

    const res = await accept(token, 'mi-clave-elegida');

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Marta Secretaria',
      email: 'marta@example.test',
      role: 'secretary',
      clinic: { id: clinic.id, name: 'Consultorio Torres', timezone: 'America/Guayaquil' }
    });
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET)).toMatchObject({ id: res.body.user.id, role: 'secretary' });
    const stored = await prisma.doctor.findUnique({ where: { email: 'marta@example.test' } });
    expect(stored.clinicId).toBe(clinic.id);
    expect(await bcrypt.compare('mi-clave-elegida', stored.password)).toBe(true);
    expect(await prisma.invitation.count()).toBe(0);
    const login = await request(app).post('/api/auth/login').send({ email: 'marta@example.test', password: 'mi-clave-elegida' });
    expect(login.status).toBe(200);
  });

  it('gives the new person the access of their role, inside the clinic only', async () => {
    const { admin, token } = await adminAndInvitation();
    await request(app).post('/api/patients').set(bearer(admin.token)).send({ name: 'Paciente', phone: '+593900000555' });
    const other = await createUser({ role: 'admin', clinic: await createClinic({ name: 'Otra Clínica' }) });
    await request(app).post('/api/patients').set(bearer(other.token)).send({ name: 'Ajeno', phone: '+593900000556' });

    const session = (await accept(token)).body.token;

    const patients = await request(app).get('/api/patients').set(bearer(session));
    expect(patients.body.patients.map((p) => p.name)).toEqual(['Paciente']);
    expect((await request(app).get('/api/admin/invitations').set(bearer(session))).status).toBe(403); // a secretary, not an admin
  });

  it('works once: the same link is dead the second time', async () => {
    const { token } = await adminAndInvitation();

    const first = await accept(token);
    const second = await accept(token);

    expect(first.status).toBe(201);
    expect(second.status).toBe(400);
    expect(second.body.code).toBe(INVALID_LINK_CODE);
    expect(await prisma.doctor.count({ where: { email: 'marta@example.test' } })).toBe(1);
  });

  it('works once even with two simultaneous requests', async () => {
    const { token } = await adminAndInvitation();

    const results = await Promise.all([accept(token), accept(token)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.doctor.count({ where: { email: 'marta@example.test' } })).toBe(1);
  });

  it('refuses a short password and keeps the invitation, so the person can try again', async () => {
    const { token } = await adminAndInvitation();

    const short = await accept(token, '12345');
    const missing = await accept(token, null);

    expect(short.status).toBe(400);
    expect(short.body.error).toBe('Password must be at least 6 characters');
    expect(missing.status).toBe(400);
    expect(await prisma.invitation.count()).toBe(1);
    expect((await accept(token)).status).toBe(201);
  });

  it('refuses an expired link, without creating anything', async () => {
    const { clinic } = await adminAndInvitation();
    const token = newToken();
    await storeInvitation(clinic, token, { expiresAt: new Date(Date.now() - 1000) });

    const res = await accept(token);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(INVALID_LINK_CODE);
    expect(await prisma.doctor.count({ where: { email: 'guardado@example.test' } })).toBe(0);
  });

  it('limits failed attempts per IP', async () => {
    for (let i = 0; i < LIMITS.accountLinkPerIp.limit; i++) expect((await accept(newToken())).status).toBe(400);

    expect((await accept(newToken())).status).toBe(429);
  });
});

describe('PUT /api/admin/clinic', () => {
  const rename = (token, name) => request(app).put('/api/admin/clinic').set(bearer(token)).send({ name });

  it('renames the admin\'s own clinic, and only theirs', async () => {
    const other = await createClinic({ name: 'Otra Clínica' }); // created first, so it is the first row of the table
    const { admin, clinic } = await adminAndInvitation();

    const res = await rename(admin.token, '  Consultorio   Dra. Torres ');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: clinic.id, name: 'Consultorio Dra. Torres', timezone: 'America/Guayaquil' });
    expect((await prisma.clinic.findUnique({ where: { id: other.id } })).name).toBe('Otra Clínica');
    const profile = await request(app).get('/api/auth/profile').set(bearer(admin.token));
    expect(profile.body.clinic.name).toBe('Consultorio Dra. Torres');
  });

  it('is used by the invitations sent afterwards', async () => {
    const { admin } = await adminAndInvitation();
    await rename(admin.token, 'Clínica Nueva');
    notifications.clear();

    await invite(admin.token, { name: 'Otra Persona', email: 'otra@example.test' });

    expect(emailsTo('otra@example.test')[0].text).toContain('Clínica Nueva');
  });

  it.each([
    ['too short', 'A'],
    ['too long', 'x'.repeat(81)],
    ['empty', '   ']
  ])('rejects a name that is %s', async (_label, name) => {
    const { admin, clinic } = await adminAndInvitation();

    const res = await rename(admin.token, name);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Clinic name must be between 2 and 80 characters');
    expect((await prisma.clinic.findUnique({ where: { id: clinic.id } })).name).toBe('Consultorio Torres');
  });

  it('is for admins only', async () => {
    const { clinic } = await adminAndInvitation();
    for (const role of ['secretary', 'doctor']) {
      const user = await createUser({ role, clinic });
      expect((await rename(user.token, 'Nombre Nuevo')).status).toBe(403);
    }
    expect((await request(app).put('/api/admin/clinic').send({ name: 'Nombre Nuevo' })).status).toBe(401);
  });
});

describe('QA mode (EXPOSE_ACCOUNT_LINKS)', () => {
  afterEach(() => {
    delete process.env.EXPOSE_ACCOUNT_LINKS;
  });

  it('returns the link of an invitation and of a resend, so a script can accept it', async () => {
    const { admin, invitation } = await adminAndInvitation();
    process.env.EXPOSE_ACCOUNT_LINKS = 'true';

    const created = await invite(admin.token, { name: 'Persona', email: 'persona@example.test' });
    const resent = await resend(admin.token, invitation.id);

    const token = created.body.devLink.match(TOKEN_IN_TEXT)[1];
    expect((await accept(token)).status).toBe(201);
    expect(resent.body.devLink).toMatch(TOKEN_IN_TEXT);
  });
});
