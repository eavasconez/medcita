const request = require('supertest');
const app = require('../src/server');
const emailService = require('../src/services/emailService');
const { prisma, resetDb } = require('./helpers/db');
const { createClinic, createUser, bearer } = require('./helpers/factories');

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
    expect(subject).toBe('[MedCita · Consultorio de pruebas] Error 500 en GET /api/patients');
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
    expect(emailService.deliverEmail.mock.calls[0][1]).toBe('[MedCita · Consultorio de pruebas] Error 500 en GET /api/appointments/:id/notifications');
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

  it('says which clinic it was and the domain the app was used from', async () => {
    const clinic = await createClinic({ name: 'Consultorio Torres', slug: 'torres' });
    const admin = await createUser({ role: 'admin', clinic });
    jest.spyOn(prisma.patient, 'findMany').mockRejectedValue(new Error('boom'));

    await request(app).get('/api/patients?search=Mar%C3%ADa').set(bearer(admin.token)).set('Origin', 'https://torres.example.test/pacientes?x=1');
    await settle();

    const [, subject, text] = emailService.deliverEmail.mock.calls[0];
    expect(subject).toBe('[MedCita · Consultorio Torres] Error 500 en GET /api/patients');
    expect(text).toContain(`Consultorio: Consultorio Torres (torres) · id ${clinic.id}`);
    expect(text).toContain('Dominio desde el que se usó la app: https://torres.example.test');
    expect(text).toMatch(/Servidor que respondió: http:\/\/127\.0\.0\.1:\d+/);
    expect(text).not.toMatch(/\/pacientes|x=1|María|search/);
  });

  it('alerts for two clinics that fail on the same route, one email each', async () => {
    const torres = await createUser({ role: 'admin', clinic: await createClinic({ name: 'Consultorio Torres' }) });
    const vida = await createUser({ role: 'admin', clinic: await createClinic({ name: 'Clínica Vida' }) });
    jest.spyOn(prisma.patient, 'findMany').mockRejectedValue(new Error('boom'));

    await request(app).get('/api/patients').set(bearer(torres.token));
    await request(app).get('/api/patients').set(bearer(vida.token));
    await request(app).get('/api/patients').set(bearer(torres.token));
    await settle();

    expect(emailService.deliverEmail.mock.calls.map((call) => call[1])).toEqual([
      '[MedCita · Consultorio Torres] Error 500 en GET /api/patients',
      '[MedCita · Clínica Vida] Error 500 en GET /api/patients'
    ]);
  });

  it('says there is no clinic when the request had no session', async () => {
    jest.spyOn(prisma.doctor, 'findUnique').mockRejectedValue(new Error('boom'));

    const res = await request(app).post('/api/auth/login').send({ email: 'ana@example.test', password: 'x' });
    await settle();

    expect(res.status).toBe(500);
    expect(emailService.deliverEmail.mock.calls[0][2]).toContain('Consultorio: no identificado (la petición no tenía sesión iniciada)');
  });

  describe('who receives it', () => {
    it('only the addresses of the people who run MedCita: never the clinic that had the error, its staff or its patients', async () => {
      process.env.ERROR_ALERT_EMAILS = 'soporte@medcita.test, ops@medcita.test';
      const clinic = await createClinic({ name: 'Consultorio Torres' });
      const owner = await createUser({ role: 'admin', email: 'dueno@clinicatorres.test', clinic });
      const doctor = await createUser({ email: 'doctora@clinicatorres.test', clinic });
      await prisma.patient.create({ data: { name: 'María Pérez', phone: '+593990000001', email: 'maria@paciente.test', clinicId: clinic.id } });
      jest.spyOn(prisma.patient, 'findMany').mockRejectedValue(new Error('boom'));

      await request(app).get('/api/patients').set(bearer(owner.token));
      await request(app).get('/api/patients').set(bearer(doctor.token));
      await settle();

      const recipients = emailService.deliverEmail.mock.calls.map((call) => call[0]);
      // one alert (the second request is the same route and clinic within 15 minutes), to each address
      expect(recipients.sort()).toEqual(['ops@medcita.test', 'soporte@medcita.test']);
      const everything = JSON.stringify(emailService.deliverEmail.mock.calls);
      expect(everything).not.toMatch(/clinicatorres\.test|paciente\.test|María/);
    });

    it('nobody at all when the support addresses are not set, even if the clinic has its own', async () => {
      delete process.env.ERROR_ALERT_EMAILS;
      const owner = await createUser({ role: 'admin', email: 'dueno@clinicatorres.test' });
      jest.spyOn(prisma.patient, 'findMany').mockRejectedValue(new Error('boom'));

      await request(app).get('/api/patients').set(bearer(owner.token));
      await settle();

      expect(emailService.deliverEmail).not.toHaveBeenCalled();
    });

    it('the person who had the error only sees the same generic answer as ever, and an id they can quote to support', async () => {
      const owner = await createUser({ role: 'admin' });
      jest.spyOn(prisma.patient, 'findMany').mockRejectedValue(new Error('Could not load María Pérez'));

      const res = await request(app).get('/api/patients').set(bearer(owner.token));

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'An unexpected error occurred' });
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{12}$/);
    });
  });
});
