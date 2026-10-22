const express = require('express');
const request = require('supertest');
const path = require('path');
const {
  createErrorAlerts,
  recipientsOf,
  routePattern,
  describeError,
  originOf,
  appFrames,
  prismaCallSite,
  schemaDetails,
  installConsoleCapture,
  requests,
  newRequestContext,
  BACKEND_ROOT,
  MIN_MINUTES_PER_ROUTE,
  MAX_ALERTS_PER_HOUR
} = require('../src/services/errorAlerts');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Alerts with a clock we move and a sender that only records
function setup({ emails = 'ops@example.test', env = {}, findClinic = async (id) => ({ name: `Clínica ${id}`, slug: `clinica-${id}` }) } = {}) {
  const sent = [];
  const clock = { now: Date.parse('2030-03-01T12:00:00Z') };
  const alerts = createErrorAlerts({
    env: { ERROR_ALERT_EMAILS: emails, ...env },
    send: async (to, subject, text, html) => sent.push({ to, subject, text, html }),
    now: () => clock.now,
    findClinic
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
    expect(text).toContain('No se pudo determinar la línea del código');
    expect(html).toContain('Error 500 en MedCita');
  });

  it('says so when the route dealt with the error itself, without inventing a type', async () => {
    const { alerts, sent } = setup();

    await alerts.report(failure);

    expect(sent[0].text).toContain('La ruta atendió el error sin dejar rastro');
    expect(sent[0].text).not.toContain('Tipo de error');
    expect(sent[0].text).not.toContain('Línea del código');
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
    // the error was made in the test, not in MedCita's code, and the alerting itself is never named as the place
    expect(sent[0].text).not.toContain('errorAlerts.js');
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

// A stack as Node prints it: libraries and Node's own frames around the lines of MedCita
const at = (file, line, column, fn) => `    at ${fn ? `${fn} (` : ''}${file}:${line}:${column}${fn ? ')' : ''}`;
const src = (file) => path.join(BACKEND_ROOT, 'src', file);
const stackOf = (...frames) => ['Error: algo falló con María Pérez, cédula 1712345678', ...frames].join('\n');

describe('appFrames', () => {
  it('reads the frame of an awaiting function, which Node prints without parentheses', () => {
    expect(appFrames(stackOf(`    at async ${src('routes/patients.js')}:37:31`, `    at async Promise.all (index 0)`))).toEqual([{ where: 'src/routes/patients.js:37:31', fn: null }]);
  });

  it('keeps the frames of MedCita\'s code, most recent first, with their relative path, line, column and function', () => {
    const stack = stackOf(
      at('/app/node_modules/@prisma/client/runtime/library.js', 123, 6854, 'handleRequestError'),
      at(src('routes/patients.js'), 57, 15, 'async list'),
      at('node:internal/process/task_queues', 105, 5, 'process.processTicksAndRejections'),
      at(src('middleware/auth.js'), 38, 5),
      at('/app/node_modules/express/lib/router/layer.js', 95, 5, 'Layer.handle')
    );

    expect(appFrames(stack)).toEqual([
      { where: 'src/routes/patients.js:57:15', fn: 'list' },
      { where: 'src/middleware/auth.js:38:5', fn: null }
    ]);
  });

  it('ignores the code outside src (tests, libraries) and the alerting itself, and says nothing for a stack without frames', () => {
    expect(appFrames(stackOf(at(path.join(BACKEND_ROOT, 'tests', 'x.test.js'), 5, 5, 'it'), at(src('services/errorAlerts.js'), 10, 3, 'middleware')))).toEqual([]);
    expect(appFrames(undefined)).toEqual([]);
    expect(appFrames('Error: sin pila')).toEqual([]);
  });
});

describe('prismaCallSite', () => {
  it('reads the line of the failing query from the first lines of a Prisma message, and nothing else', () => {
    // the message exactly as Prisma writes it: the path is on the line after "in"
    const message = `\nInvalid \`prisma.patient.create()\` invocation in\n${src('routes/patients.js')}:57:15\n\n  55 data: {\n→ 57   prisma.patient.create(\nUnique constraint failed on the fields: (\`phone\`) María Pérez`;

    expect(prismaCallSite(message)).toBe('src/routes/patients.js:57:15');
    expect(prismaCallSite(message.replace('in\n', 'in '))).toBe('src/routes/patients.js:57:15'); // and on the same line
  });

  it('gives nothing for a call site outside MedCita\'s code or a message without one', () => {
    expect(prismaCallSite('Invalid `prisma.x.y()` invocation in /somewhere/else/file.js:1:1:')).toBeNull();
    expect(prismaCallSite('Unique constraint failed on the fields: (`phone`)')).toBeNull();
    expect(prismaCallSite(undefined)).toBeNull();
  });
});

describe('schemaDetails', () => {
  it('reads the names of columns, tables and constraint fields that Prisma reports', () => {
    expect(schemaDetails({ meta: { column: 'Patient.cedula', modelName: 'Patient' } })).toEqual(['column: Patient.cedula', 'modelName: Patient']);
    expect(schemaDetails({ meta: { target: ['clinicId', 'phone'] } })).toEqual(['target: clinicId, phone']);
  });

  it('never reads a value: only plain identifiers, only the known keys', () => {
    expect(schemaDetails({ meta: { column: 'María Pérez', target: ['1712345678 x'], cause: 'name = "María"', modelName: 'Patient;DROP' } })).toEqual([]);
    expect(schemaDetails({ meta: { target: Array.from({ length: 7 }, (_, i) => `f${i}`) } })).toEqual([]);
    expect(schemaDetails({})).toEqual([]);
    expect(schemaDetails(null)).toEqual([]);
  });
});

describe('describeError', () => {
  it('names the place in the code, the type and the code, and keeps the message out', () => {
    const error = Object.assign(new Error('Could not save María Pérez, cédula 1712345678'), { name: 'PrismaClientKnownRequestError', code: 'P2022', meta: { column: 'Patient.cedula' } });
    error.stack = stackOf(at(src('routes/patients.js'), 57, 15, 'async list'), at(src('middleware/auth.js'), 38, 5));

    const described = describeError(error);

    expect(described).toEqual({
      name: 'PrismaClientKnownRequestError',
      code: 'P2022',
      location: 'src/routes/patients.js:57:15',
      fn: 'list',
      frames: [{ where: 'src/routes/patients.js:57:15', fn: 'list' }, { where: 'src/middleware/auth.js:38:5', fn: null }],
      details: ['column: Patient.cedula']
    });
    expect(JSON.stringify(described)).not.toMatch(/María|1712345678|Could not save/);
  });

  it('reads the line of a failing query from the message Prisma writes, and the awaiting frame from the stack', () => {
    // a real Prisma error: it is born inside the library, and the stack only reaches MedCita through
    // the function that was awaiting it ("at async /abs/path/file.js:37:31", no parentheses)
    const error = Object.assign(new Error(`\nInvalid \`prisma.patient.findMany()\` invocation in\n${src('routes/patients.js')}:38:22\n\n  35 \n  36 try {\n  37   const [patients, total] = await Promise.all([\n→ 38     prisma.patient.findMany(\nThe column \`Patient.cedula\` does not exist in the current database.`), { name: 'PrismaClientKnownRequestError', code: 'P2022', meta: { modelName: 'Patient', column: 'Patient.cedula' } });
    error.stack = stackOf(
      at('/app/node_modules/@prisma/client/runtime/library.js', 123, 6854, '_n.handleRequestError'),
      at('/app/node_modules/@prisma/client/runtime/library.js', 123, 5896, '_n.request'),
      `    at async l (/app/node_modules/@prisma/client/runtime/library.js:128:10871)`,
      `    at async Promise.all (index 0)`,
      `    at async ${src('routes/patients.js')}:37:31`
    );

    expect(describeError(error)).toEqual({
      name: 'PrismaClientKnownRequestError',
      code: 'P2022',
      location: 'src/routes/patients.js:38:22',
      fn: null,
      frames: [{ where: 'src/routes/patients.js:37:31', fn: null }],
      details: ['column: Patient.cedula', 'modelName: Patient']
    });
  });

  it('falls back to the call site in the message when the stack has no frame of MedCita at all', () => {
    const error = new Error(`Invalid \`prisma.patient.findMany()\` invocation in\n${src('routes/patients.js')}:57:15:\n\n  name: "María Pérez"`);
    error.stack = stackOf(at('/app/node_modules/@prisma/client/runtime/library.js', 123, 6854, 'handleRequestError'));

    expect(describeError(error)).toMatchObject({ location: 'src/routes/patients.js:57:15', fn: null, frames: [] });
  });

  it('is empty-handed, but does not fail, for an error with no place in MedCita\'s code or for no error', () => {
    const error = new Error('x');
    error.stack = stackOf(at('/app/node_modules/x/index.js', 1, 1, 'f'));

    expect(describeError(error)).toMatchObject({ location: null, frames: [] });
    expect(describeError(undefined)).toBeNull();
  });

  it('keeps at most five frames', () => {
    const error = new Error('x');
    error.stack = stackOf(...Array.from({ length: 9 }, (_, i) => at(src(`routes/r${i}.js`), i + 1, 1, `f${i}`)));

    expect(describeError(error).frames).toHaveLength(5);
  });
});

describe('what the email says about the code', () => {
  const described = (extra = {}) => ({
    name: 'PrismaClientKnownRequestError',
    code: 'P2022',
    location: 'src/routes/patients.js:57:15',
    fn: 'list',
    frames: [{ where: 'src/routes/patients.js:57:15', fn: 'list' }, { where: 'src/middleware/auth.js:38:5', fn: null }],
    details: ['column: Patient.cedula'],
    ...extra
  });

  it('puts the exact line, the type, the schema detail, the call chain and the request id in the body', async () => {
    const { alerts, sent } = setup();

    await alerts.report({ method: 'GET', route: '/api/patients', status: 500, error: described(), requestId: 'a1b2c3d4e5f6' });

    const { text } = sent[0];
    expect(text).toContain('MedCita devolvió un error 500 en GET /api/patients.');
    expect(text).toContain('Tipo de error: PrismaClientKnownRequestError (P2022)');
    expect(text).toContain('Línea del código: src/routes/patients.js:57:15 (en list)');
    expect(text).toContain('Detalle del esquema: column: Patient.cedula');
    expect(text).toContain('Pila (solo código de MedCita):\n  src/routes/patients.js:57:15 (list)\n  src/middleware/auth.js:38:5');
    expect(text).toContain('Id de la petición: a1b2c3d4e5f6 — búscalo en los logs de Render para ver el mensaje completo del error.');
    expect(text).toContain('ni el mensaje del error');
  });

  it('names the file and line in the subject, so the inbox already says where', async () => {
    const { alerts, sent } = setup();

    await alerts.report({ method: 'GET', route: '/api/patients', status: 500, error: described() });

    expect(sent[0].subject).toBe('[MedCita] Error 500 en GET /api/patients (src/routes/patients.js:57)');
  });

  it('shows the line in bold in the HTML and escapes what it prints', async () => {
    const { alerts, sent } = setup();

    await alerts.report({ method: 'GET', route: '/api/patients', status: 500, error: described({ fn: '<b>x</b>' }) });

    expect(sent[0].html).toContain('font-weight: bold;">Línea del código: src/routes/patients.js:57:15');
    expect(sent[0].html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(sent[0].html).not.toContain('<b>x</b>');
  });

  it('does not print a one-frame chain twice', async () => {
    const { alerts, sent } = setup();

    await alerts.report({ method: 'GET', route: '/x', status: 500, error: described({ frames: [{ where: 'src/routes/patients.js:57:15', fn: 'list' }] }) });

    expect(sent[0].text).not.toContain('Pila (solo código de MedCita)');
  });
});

describe('remembering the error of a request', () => {
  it('keeps the error given to console.error while a request is served, and writes the request id before the line', () => {
    const written = [];
    const fake = { error: (...args) => written.push(args) };
    installConsoleCapture(fake);
    const context = { id: 'abc123abc123', errors: [] };
    const error = new Error('boom');

    requests.run(context, () => {
      fake.error('List patients error:', error);
      fake.error('List patients error:', error); // the same one twice is one
    });

    expect(context.errors).toEqual([error]);
    expect(written[0]).toEqual(['[request abc123abc123]', 'List patients error:', error]);
  });

  it('leaves what is logged outside a request exactly as it was, and installs only once', () => {
    const written = [];
    const fake = { error: (...args) => written.push(args) };
    installConsoleCapture(fake);
    const once = fake.error;
    installConsoleCapture(fake);

    fake.error('boot problem', new Error('x'));

    expect(fake.error).toBe(once);
    expect(written).toEqual([['boot problem', expect.any(Error)]]);
  });

  it('gives every request its own id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRequestContext().id));

    expect(ids.size).toBe(50);
    expect([...ids].every((id) => /^[0-9a-f]{12}$/.test(id))).toBe(true);
  });

  describe('inside an Express app', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

    function appThatCatches(alerts) {
      const app = express();
      app.use(alerts.middleware);
      app.get('/api/patients', (req, res) => {
        // what almost every route does: log the error and answer 500 by itself
        const error = Object.assign(new Error('Could not load María Pérez (cédula 1712345678)'), { code: 'P2022', meta: { column: 'Patient.cedula' } });
        error.stack = stackOf(at(src('routes/patients.js'), 57, 15, 'async list'));
        console.error('List patients error:', error);
        res.status(500).json({ error: 'An unexpected error occurred' });
      });
      return app;
    }

    it('alerts with the line of the error the route caught, and sends the request id back in a header', async () => {
      jest.spyOn(console, 'error'); // calls through: the capture sits underneath
      const { alerts, sent } = setup();

      const res = await request(appThatCatches(alerts)).get('/api/patients?search=Mar%C3%ADa');
      await settle();

      expect(res.status).toBe(500);
      const id = res.headers['x-request-id'];
      expect(id).toMatch(/^[0-9a-f]{12}$/);
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe('[MedCita] Error 500 en GET /api/patients (src/routes/patients.js:57)');
      expect(sent[0].text).toContain('Línea del código: src/routes/patients.js:57:15 (en list)');
      expect(sent[0].text).toContain('Tipo de error: Error (P2022)');
      expect(sent[0].text).toContain('Detalle del esquema: column: Patient.cedula');
      expect(sent[0].text).toContain(`Id de la petición: ${id}`);
      expect(JSON.stringify(sent[0])).not.toMatch(/María|Pérez|1712345678|Could not load|search/);
      jest.restoreAllMocks();
    });

    it('keeps the requests apart: the error of one is never reported for another', async () => {
      jest.spyOn(console, 'error');
      const { alerts, sent } = setup();
      const app = appThatCatches(alerts);
      app.get('/api/other', (req, res) => res.status(500).json({ error: 'An unexpected error occurred' }));

      await Promise.all([request(app).get('/api/other'), request(app).get('/api/patients')]);
      await settle();

      const bySubject = Object.fromEntries(sent.map((m) => [m.subject.split(' (')[0], m.text]));
      expect(bySubject['[MedCita] Error 500 en GET /api/patients']).toContain('src/routes/patients.js:57');
      expect(bySubject['[MedCita] Error 500 en GET /api/other']).toContain('La ruta atendió el error sin dejar rastro');
      jest.restoreAllMocks();
    });
  });
});

describe('originOf', () => {
  it('takes the scheme, host and port of the domain the app was used from, and nothing after it', () => {
    expect(originOf('https://consultorio.medcita.ec')).toBe('https://consultorio.medcita.ec');
    expect(originOf('https://consultorio.medcita.ec/pacientes/42?busca=María#x')).toBe('https://consultorio.medcita.ec');
    expect(originOf('http://localhost:5173')).toBe('http://localhost:5173');
    // a user and password written in the address are not kept
    expect(originOf('https://usuario:clave@torres.medcita.ec/x')).toBe('https://torres.medcita.ec');
  });

  it('refuses anything that is not a plain web address', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://x.example', 'not a url', '', undefined, null, 'https://a b.example']) {
      expect(originOf(bad)).toBeNull();
    }
  });
});

describe('which clinic the error belongs to', () => {
  const error = { name: 'Error', location: 'src/routes/patients.js:57:15', fn: 'list', frames: [], details: [] };

  it('names the clinic, with its short name and id, in the body and in the subject', async () => {
    const { alerts, sent } = setup({ findClinic: async () => ({ name: 'Clínica Vida (demo)', slug: 'clinica-vida' }) });

    await alerts.report({ method: 'GET', route: '/api/patients', status: 500, error, clinicId: 'c-123' });

    expect(sent[0].text).toContain('Consultorio: Clínica Vida (demo) (clinica-vida) · id c-123');
    expect(sent[0].subject).toBe('[MedCita · Clínica Vida (demo)] Error 500 en GET /api/patients (src/routes/patients.js:57)');
    expect(sent[0].html).toContain('font-weight: bold;">Consultorio: Clínica Vida (demo)');
  });

  it('says so when the request had no session, so there is no clinic to name', async () => {
    const { alerts, sent } = setup();

    await alerts.report({ method: 'POST', route: '/api/auth/login', status: 500, error });

    expect(sent[0].text).toContain('Consultorio: no identificado (la petición no tenía sesión iniciada)');
    expect(sent[0].subject).toBe('[MedCita] Error 500 en POST /api/auth/login (src/routes/patients.js:57)');
  });

  it('still sends the alert, with the id alone, when the name cannot be looked up (the database may be what failed)', async () => {
    const { alerts, sent } = setup({ findClinic: async () => { throw new Error('database unreachable'); } });

    const delivered = await alerts.report({ method: 'GET', route: '/api/patients', status: 500, error, clinicId: 'c-123' });

    expect(delivered).toBe(true);
    expect(sent[0].text).toContain('Consultorio: id c-123 (no se pudo consultar su nombre)');
    expect(sent[0].subject).toBe('[MedCita] Error 500 en GET /api/patients (src/routes/patients.js:57)');
  });

  it('does the same for a clinic that no longer exists', async () => {
    const { alerts, sent } = setup({ findClinic: async () => null });

    await alerts.report({ method: 'GET', route: '/x', status: 500, clinicId: 'c-gone' });

    expect(sent[0].text).toContain('Consultorio: id c-gone (no se pudo consultar su nombre)');
  });

  it('keeps a name written on several lines to one line in the subject', async () => {
    const { alerts, sent } = setup({ findClinic: async () => ({ name: 'Clínica\r\nBcc: x@y.z   Vida', slug: 'vida' }) });

    await alerts.report({ method: 'GET', route: '/x', status: 500, clinicId: 'c1' });

    expect(sent[0].subject).not.toMatch(/[\r\n]/);
    expect(sent[0].subject).toContain('Clínica Bcc: x@y.z Vida');
  });

  it('names the domain the app was used from and the server that answered', async () => {
    const { alerts, sent } = setup();

    await alerts.report({ method: 'GET', route: '/x', status: 500, origin: 'https://torres.medcita.ec', apiOrigin: 'https://medcita-backend.onrender.com' });

    expect(sent[0].text).toContain('Dominio desde el que se usó la app: https://torres.medcita.ec');
    expect(sent[0].text).toContain('Servidor que respondió: https://medcita-backend.onrender.com');
  });

  it('leaves the domain out when the request did not say one', async () => {
    const { alerts, sent } = setup();

    await alerts.report({ method: 'GET', route: '/x', status: 500 });

    expect(sent[0].text).not.toContain('Dominio desde el que se usó la app');
  });

  it('counts a route apart for each clinic: it tells every clinic that fails, once per 15 minutes each', async () => {
    const { alerts, sent, clock } = setup();
    const fail = (clinicId) => alerts.report({ method: 'GET', route: '/api/patients', status: 500, clinicId });

    expect(await fail('a')).toBe(true);
    expect(await fail('b')).toBe(true);
    expect(await fail('a')).toBe(false);
    expect(await fail('b')).toBe(false);
    clock.now += 16 * MINUTE;
    expect(await fail('a')).toBe(true);

    expect(sent).toHaveLength(3);
    expect(sent[2].text).toContain('Consultorio: Clínica a');
    expect(sent[2].text).toContain('hubo 1 error más');
  });
});
