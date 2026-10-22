const express = require('express');
const request = require('supertest');
const { createErrorAlerts, recipientsOf, routePattern, MIN_MINUTES_PER_ROUTE, MAX_ALERTS_PER_HOUR } = require('../src/services/errorAlerts');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Alerts with a clock we move and a sender that only records
function setup({ emails = 'ops@example.test', env = {} } = {}) {
  const sent = [];
  const clock = { now: Date.parse('2030-03-01T12:00:00Z') };
  const alerts = createErrorAlerts({
    env: { ERROR_ALERT_EMAILS: emails, ...env },
    send: async (to, subject, text, html) => sent.push({ to, subject, text, html }),
    now: () => clock.now
  });
  return { alerts, sent, clock };
}
const failure = { method: 'POST', route: '/api/appointments/:id', status: 500 };

describe('recipientsOf', () => {
  it('reads the addresses of ERROR_ALERT_EMAILS, ignoring blanks and what is not an address', () => {
    expect(recipientsOf({ ERROR_ALERT_EMAILS: ' ops@example.test , dev@example.test,,not-an-email, ' })).toEqual(['ops@example.test', 'dev@example.test']);
    expect(recipientsOf({ ERROR_ALERT_EMAILS: '' })).toEqual([]);
    expect(recipientsOf({})).toEqual([]);
  });
});

describe('routePattern', () => {
  it('names the route by its pattern, never by the real path', () => {
    expect(routePattern({ baseUrl: '/api/appointments', route: { path: '/:id' } })).toBe('/api/appointments/:id');
    expect(routePattern({ baseUrl: '/api/appointments', route: { path: '/' } })).toBe('/api/appointments');
    expect(routePattern({ baseUrl: '/api/admin', route: { path: ['/doctors', '/medicos'] } })).toBe('/api/admin/doctors');
    expect(routePattern({ baseUrl: '', route: { path: '/api/tasks/reminders' } })).toBe('/api/tasks/reminders');
    expect(routePattern({ baseUrl: '/api/patients' })).toBe('/api/patients');
    expect(routePattern({ baseUrl: '' })).toBe('(no route matched)');
  });
});

describe('report', () => {
  it('emails every recipient: which route failed, the kind of error and where to look', async () => {
    const { alerts, sent } = setup({ emails: 'ops@example.test,dev@example.test', env: { RENDER_SERVICE_NAME: 'medcita-backend', RENDER_GIT_COMMIT: 'abcdef1234567890' } });

    const delivered = await alerts.report({ ...failure, error: { name: 'PrismaClientKnownRequestError', code: 'P2022' } });

    expect(delivered).toBe(true);
    expect(sent.map((m) => m.to)).toEqual(['ops@example.test', 'dev@example.test']);
    const { subject, text, html } = sent[0];
    expect(subject).toBe('[MedCita] Error 500 en POST /api/appointments/:id');
    expect(text).toContain('MedCita devolvió un error 500 en POST /api/appointments/:id');
    expect(text).toContain('Tipo de error: PrismaClientKnownRequestError (P2022)');
    expect(text).toContain('Servicio: medcita-backend · versión abcdef1');
    expect(text).toMatch(/Hora \(UTC\): 20\d\d-/);
    expect(text).toContain('Revisa los logs del servicio en Render');
    expect(html).toContain('Error 500 en MedCita');
  });

  it('says so when the route dealt with the error itself, without inventing a type', async () => {
    const { alerts, sent } = setup();

    await alerts.report(failure);

    expect(sent[0].text).toContain('El error fue atendido por la propia ruta');
    expect(sent[0].text).not.toContain('Tipo de error');
  });

  it('sends nothing, and holds nothing back, when no recipient is set', async () => {
    const { alerts, sent } = setup({ emails: '' });

    expect(await alerts.report(failure)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('escapes what goes into the HTML', async () => {
    const { alerts, sent } = setup();

    await alerts.report({ method: 'GET', route: '/api/<img src=x>', status: 500 });

    expect(sent[0].html).not.toContain('<img');
    expect(sent[0].html).toContain('&lt;img');
  });

  describe('not flooding', () => {
    it('sends one alert per route every 15 minutes and counts what it held back', async () => {
      const { alerts, sent, clock } = setup();

      expect(await alerts.report(failure)).toBe(true);
      clock.now += 2 * MINUTE;
      expect(await alerts.report(failure)).toBe(false);
      clock.now += 5 * MINUTE;
      expect(await alerts.report(failure)).toBe(false);
      expect(sent).toHaveLength(1);

      clock.now += MIN_MINUTES_PER_ROUTE * MINUTE;
      expect(await alerts.report(failure)).toBe(true);
      expect(sent).toHaveLength(2);
      expect(sent[1].text).toContain('Desde el último aviso de esta ruta hubo 2 errores más.');
    });

    it('says "1 error" and not "1 errores", and says nothing when none was held back', async () => {
      const { alerts, sent, clock } = setup();
      await alerts.report(failure);
      clock.now += MINUTE;
      await alerts.report(failure);
      clock.now += 20 * MINUTE;
      await alerts.report(failure);
      clock.now += 20 * MINUTE;
      await alerts.report(failure);

      expect(sent[1].text).toContain('hubo 1 error más');
      expect(sent[2].text).not.toContain('Desde el último aviso');
    });

    it('keeps every route apart: a failing route does not silence another', async () => {
      const { alerts, sent } = setup();

      await alerts.report(failure);
      await alerts.report({ ...failure, route: '/api/patients' });
      await alerts.report({ ...failure, method: 'GET' });

      expect(sent.map((m) => m.subject)).toEqual([
        '[MedCita] Error 500 en POST /api/appointments/:id',
        '[MedCita] Error 500 en POST /api/patients'.replace('POST', 'POST'),
        '[MedCita] Error 500 en GET /api/appointments/:id'
      ]);
    });

    it('sends at most 10 alerts an hour for the whole platform, then starts again', async () => {
      const { alerts, sent, clock } = setup();

      for (let i = 0; i < MAX_ALERTS_PER_HOUR + 5; i++) await alerts.report({ ...failure, route: `/api/ruta-${i}` });
      expect(sent).toHaveLength(MAX_ALERTS_PER_HOUR);

      clock.now += HOUR + MINUTE;
      expect(await alerts.report({ ...failure, route: '/api/ruta-nueva' })).toBe(true);
      expect(sent).toHaveLength(MAX_ALERTS_PER_HOUR + 1);
    });
  });
});

describe('inside an Express app', () => {
  function appWith(alerts) {
    const app = express();
    app.use(express.json());
    app.use(alerts.middleware);
    const router = express.Router();
    router.get('/caught', (req, res) => res.status(500).json({ error: 'An unexpected error occurred' }));
    router.get('/thrown/:id', () => {
      const err = new Error('could not save the patient María Pérez, cédula 1712345678');
      err.code = 'P2002';
      throw err;
    });
    router.get('/gateway', (req, res) => res.status(502).end());
    router.get('/bad-request', (req, res) => res.status(400).json({ error: 'nope' }));
    router.get('/missing', (req, res) => res.status(404).json({ error: 'nope' }));
    router.post('/echo', (req, res) => res.json(req.body));
    app.use('/api/things', router);
    app.get('/api/health', (req, res) => res.status(503).json({ status: 'error' }));
    app.use(alerts.errorHandler);
    return app;
  }
  // The alert goes out after the answer: give it a moment
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  it('alerts when a route answers 500 by itself, with the route pattern and not the query', async () => {
    const { alerts, sent } = setup();

    const res = await request(appWith(alerts)).get('/api/things/caught?search=Mar%C3%ADa&cedula=1712345678');
    await settle();

    expect(res.status).toBe(500);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('[MedCita] Error 500 en GET /api/things/caught');
    expect(JSON.stringify(sent[0])).not.toMatch(/Mar|1712345678|search|cedula/);
  });

  it('answers a thrown error with a JSON 500 and alerts with its type and code, never its message', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { alerts, sent } = setup();

    const res = await request(appWith(alerts)).get('/api/things/thrown/42');
    await settle();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'An unexpected error occurred' });
    expect(sent[0].subject).toBe('[MedCita] Error 500 en GET /api/things/thrown/:id');
    expect(sent[0].text).toContain('Tipo de error: Error (P2002)');
    expect(JSON.stringify(sent[0])).not.toMatch(/María|Pérez|1712345678|cédula|\/42/);
    jest.restoreAllMocks();
  });

  it('alerts on any 5xx, but not on a client error or a health check that says "not ready"', async () => {
    const { alerts, sent } = setup();
    const app = appWith(alerts);

    await request(app).get('/api/things/gateway');
    await request(app).get('/api/things/bad-request');
    await request(app).get('/api/things/missing');
    await request(app).get('/api/health');
    await settle();

    expect(sent.map((m) => m.subject)).toEqual(['[MedCita] Error 502 en GET /api/things/gateway']);
  });

  it('keeps a bad request as the client error it is: a body that is not JSON answers 400, with no alert', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { alerts, sent } = setup();

    const res = await request(appWith(alerts)).post('/api/things/echo').set('Content-Type', 'application/json').send('{"roto":');
    await settle();

    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
    jest.restoreAllMocks();
  });

  it('does not slow the answer: a failing sender neither delays it nor breaks it', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const alerts = createErrorAlerts({
      env: { ERROR_ALERT_EMAILS: 'ops@example.test' },
      send: () => Promise.reject(new Error('the email provider is down'))
    });

    const res = await request(appWith(alerts)).get('/api/things/caught');
    await settle();

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith('Could not send the error alert:', 'the email provider is down');
    jest.restoreAllMocks();
  });
});
