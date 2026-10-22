const request = require('supertest');
const app = require('../src/server');
const emailService = require('../src/services/emailService');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, bearer } = require('./helpers/factories');

let savedEnv;
beforeEach(async () => {
  await resetDb();
  savedEnv = process.env.ERROR_ALERT_EMAILS;
  process.env.ERROR_ALERT_EMAILS = 'ops@example.test';
  jest.spyOn(emailService, 'deliverEmail').mockResolvedValue({ ok: true, provider: 'test' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  if (savedEnv === undefined) delete process.env.ERROR_ALERT_EMAILS;
  else process.env.ERROR_ALERT_EMAILS = savedEnv;
});
afterAll(() => prisma.$disconnect());

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

// The real app, with a database that fails halfway: a 500 that a route answered by itself
describe('the real server', () => {
  it('emails an alert when a route ends in a 500, without anything about the patient or the request', async () => {
    const admin = await createUser({ role: 'admin' });
    jest.spyOn(prisma.patient, 'findMany').mockRejectedValue(Object.assign(new Error('Invalid prisma.patient.findMany() invocation: name = "María Pérez"'), { code: 'P2022' }));

    const res = await request(app).get('/api/patients?search=Mar%C3%ADa%20P%C3%A9rez').set(bearer(admin.token));
    await settle();

    expect(res.status).toBe(500);
    expect(emailService.deliverEmail).toHaveBeenCalledTimes(1);
    const [to, subject, text, html] = emailService.deliverEmail.mock.calls[0];
    expect(to).toBe('ops@example.test');
    expect(subject).toBe('[MedCita] Error 500 en GET /api/patients');
    expect(`${text}${html}`).not.toMatch(/María|Pérez|search|Invalid prisma/);
  });

  it('names a route with an id by its pattern, and does not repeat itself within 15 minutes', async () => {
    const admin = await createUser({ role: 'admin' });
    jest.spyOn(prisma.appointment, 'findFirst').mockRejectedValue(new Error('boom'));
    const hit = (id) => request(app).get(`/api/appointments/${id}/notifications`).set(bearer(admin.token));

    await hit('a1b2c3');
    await hit('d4e5f6');
    await hit('a1b2c3');
    await settle();

    expect(emailService.deliverEmail).toHaveBeenCalledTimes(1);
    expect(emailService.deliverEmail.mock.calls[0][1]).toBe('[MedCita] Error 500 en GET /api/appointments/:id/notifications');
  });

  it('sends nothing without ERROR_ALERT_EMAILS, the way it always was', async () => {
    delete process.env.ERROR_ALERT_EMAILS;
    const admin = await createUser({ role: 'admin' });
    jest.spyOn(prisma.doctor, 'findMany').mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/admin/doctors').set(bearer(admin.token));
    await settle();

    expect(res.status).toBe(500);
    expect(emailService.deliverEmail).not.toHaveBeenCalled();
  });

  it('does not alert for an answer that is not a server error', async () => {
    await request(app).post('/api/auth/login').send({ email: 'nadie@example.test', password: 'x' });
    await request(app).get('/api/patients');
    await request(app).get('/api/no-such-route');
    await settle();

    expect(emailService.deliverEmail).not.toHaveBeenCalled();
  });
});
