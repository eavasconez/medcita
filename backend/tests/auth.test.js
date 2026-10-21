const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, bearer } = require('./helpers/factories');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('POST /api/auth/login', () => {
  it('returns a token and the user for valid credentials', async () => {
    const { user } = await createUser({ email: 'login@example.test', password: 'secret123' });

    const res = await request(app).post('/api/auth/login').send({ email: 'login@example.test', password: 'secret123' });

    expect(res.status).toBe(200);
    const clinic = await prisma.clinic.findUnique({ where: { id: user.clinicId } });
    expect(res.body.user).toEqual({
      id: user.id,
      name: user.name,
      email: 'login@example.test',
      role: 'doctor',
      clinic: { id: clinic.id, name: clinic.name, timezone: clinic.timezone }
    });
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET)).toMatchObject({ id: user.id, role: 'doctor' });
  });

  it('accepts the email with different case and surrounding spaces', async () => {
    await createUser({ email: 'login@example.test', password: 'secret123' });

    const res = await request(app).post('/api/auth/login').send({ email: '  LOGIN@example.test ', password: 'secret123' });

    expect(res.status).toBe(200);
  });

  it('answers 401 "Invalid credentials" for a wrong password', async () => {
    await createUser({ email: 'login@example.test', password: 'secret123' });

    const res = await request(app).post('/api/auth/login').send({ email: 'login@example.test', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
    expect(res.body).not.toHaveProperty('token');
  });

  it('answers the same 401 for an unknown email, so accounts cannot be enumerated', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password: 'whatever1' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it.each([
    ['missing email', { password: 'secret123' }],
    ['missing password', { email: 'login@example.test' }],
    ['empty body', {}]
  ])('returns 400 for %s', async (_label, body) => {
    const res = await request(app).post('/api/auth/login').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email and password are required');
  });
});

describe('JWT middleware (protected routes)', () => {
  it('rejects a request without a token', async () => {
    const res = await request(app).get('/api/auth/profile');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('rejects a malformed token', async () => {
    const res = await request(app).get('/api/auth/profile').set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token');
  });

  it('rejects a token signed with a different secret', async () => {
    const { user } = await createUser();
    const forged = jwt.sign({ id: user.id, role: 'admin' }, 'some-other-secret-that-is-long-enough-123');

    const res = await request(app).get('/api/auth/profile').set(bearer(forged));

    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { user } = await createUser();
    const expired = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: -10 });

    const res = await request(app).get('/api/auth/profile').set(bearer(expired));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token');
  });

  it.each(['/api/appointments', '/api/patients', '/api/availability', '/api/admin/doctors', '/api/admin/medicos'])(
    'protects %s',
    async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  );

  it('keeps /api/health public', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/auth/profile', () => {
  it('returns the profile of the authenticated user without the password hash', async () => {
    const { user, token } = await createUser({ specialty: 'Pediatría', bio: 'Bio' });

    const res = await request(app).get('/api/auth/profile').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      email: user.email,
      role: 'doctor',
      specialty: 'Pediatría',
      bio: 'Bio',
      _count: { appointments: 0 }
    });
    expect(res.body).not.toHaveProperty('password');
  });

  it('rejects the token of a user that no longer exists', async () => {
    const { user, token } = await createUser();
    await prisma.doctor.delete({ where: { id: user.id } });

    const res = await request(app).get('/api/auth/profile').set(bearer(token));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token');
  });
});

describe('PUT /api/auth/profile', () => {
  it('updates name, specialty, bio and address, trimming values', async () => {
    const { token } = await createUser();

    const res = await request(app)
      .put('/api/auth/profile')
      .set(bearer(token))
      .send({ name: '  Dr. Nuevo  ', specialty: ' Cardiología ', bio: ' Mi bio ', address: ' Av. Siempre Viva 123 ' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Dr. Nuevo',
      specialty: 'Cardiología',
      bio: 'Mi bio',
      address: 'Av. Siempre Viva 123'
    });
  });

  it('stores an empty string as null so the field is cleared', async () => {
    const { token } = await createUser({ specialty: 'Pediatría' });

    const res = await request(app).put('/api/auth/profile').set(bearer(token)).send({ specialty: '' });

    expect(res.status).toBe(200);
    expect(res.body.specialty).toBeNull();
  });

  it('does not let the user change their role or email through the profile', async () => {
    const { user, token } = await createUser();

    const res = await request(app)
      .put('/api/auth/profile')
      .set(bearer(token))
      .send({ role: 'admin', email: 'hacker@example.test', name: 'Same Person' });

    expect(res.status).toBe(200);
    const stored = await prisma.doctor.findUnique({ where: { id: user.id } });
    expect(stored.role).toBe('doctor');
    expect(stored.email).toBe(user.email);
    expect(stored.name).toBe('Same Person');
  });

  it.each([
    ['blank name', { name: '   ' }, 'Name is required'],
    ['non-string name', { name: 42 }, 'Name is required'],
    ['non-string specialty', { specialty: 42 }, 'Specialty must be a string'],
    ['non-string bio', { bio: {} }, 'Bio must be a string'],
    ['non-string address', { address: [] }, 'Address must be a string']
  ])('returns 400 for %s', async (_label, body, message) => {
    const { token } = await createUser();

    const res = await request(app).put('/api/auth/profile').set(bearer(token)).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });

  it('requires authentication', async () => {
    const res = await request(app).put('/api/auth/profile').send({ name: 'X' });

    expect(res.status).toBe(401);
  });
});
