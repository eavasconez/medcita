// A server error (500) is only visible in Render's logs, so one can go on unnoticed until a user
// complains. This emails whoever runs the platform when a request ends in a 5xx (S9-08): which
// route, WHERE IN THE CODE it happened (file and line), what kind of error, and an id to find the
// full message in the logs.
//
// What an alert never carries: the request body, the query string, the ids in the path (only the
// route pattern, like `/api/patients/:id`), who made the request, their IP, or the text of the
// error. It does say WHICH CLINIC the request belonged to (its name, from the signed-in account) and
// the domain the app was used from: that is about the business, not about a patient. An error message can quote a value that was being saved (a patient's name, a cédula), and
// an email is not encrypted and sits in an inbox: the message stays in the log, and the alert gives
// the id of the request so the operator finds it there in one search.
//
// It does not flood: one email per route every 15 minutes (counting the errors it held back, which
// the next one reports) and at most 10 in an hour for the whole platform. Turned on by naming the
// recipients in ERROR_ALERT_EMAILS (comma-separated); without it nothing is sent and the errors
// are only in the log, as before.

const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const prisma = require('../config/prisma');
const emailService = require('./emailService');

const MIN_MINUTES_PER_ROUTE = 15;
const MAX_ALERTS_PER_HOUR = 10;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MAX_FRAMES = 5;

// A health check that says "not ready" (503) is for the uptime monitor, not for an email each time
const SKIPPED_PATHS = ['/api/health'];

// The backend folder: only the code of MedCita (backend/src) is named in an alert, never a library's
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const APP_CODE = path.join(BACKEND_ROOT, 'src') + path.sep;

const recipientsOf = (env) =>
  String(env.ERROR_ALERT_EMAILS || '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

// --- What happened to a request ---------------------------------------------------------------
// Every request runs inside a context that remembers an id and the errors the code reported while
// serving it, so the alert can say what went wrong even when the route caught the error itself and
// answered 500 (almost all of them do: they log it with console.error and respond).

const requests = new AsyncLocalStorage();

const newRequestContext = () => ({ id: crypto.randomBytes(6).toString('hex'), errors: [] });

const firstError = (args) => args.find((arg) => arg instanceof Error);

// Makes console.error remember the error it is given while a request is being served, and puts the
// request id in front of the line so the log line can be found from the alert. Anything outside a
// request is logged exactly as before. Installed once.
function installConsoleCapture(target = console) {
  if (target.error.__capturesRequestErrors) return;
  const original = target.error;
  const wrapped = function (...args) {
    const context = requests.getStore();
    if (!context) return original.apply(this, args);
    const error = firstError(args);
    if (error && !context.errors.includes(error)) context.errors.push(error);
    return original.apply(this, [`[request ${context.id}]`, ...args]);
  };
  wrapped.__capturesRequestErrors = true;
  target.error = wrapped;
}

// --- Where in the code -------------------------------------------------------------------------

// "at fn (/abs/path/file.js:87:15)" or "at /abs/path/file.js:87:15" -> { file, line, column, fn }
const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

// The frames of MedCita's own code in a stack, most recent first, as "src/routes/patients.js:87:15"
function appFrames(stack) {
  const frames = [];
  for (const line of String(stack || '').split('\n')) {
    const match = line.match(FRAME);
    if (!match) continue;
    const [, fn, rawFile, lineNumber, column] = match;
    // A frame of an awaiting function has no parentheses: "at async /abs/path/file.js:37:31"
    const file = rawFile.replace(/^async /, '');
    const absolute = file.startsWith('file://') ? file.slice(7) : file;
    // The alerting itself sits in every request's call stack: it is never where the error is
    if (!absolute.startsWith(APP_CODE) || absolute === __filename) continue;
    frames.push({ where: `${path.relative(BACKEND_ROOT, absolute).split(path.sep).join('/')}:${lineNumber}:${column}`, fn: fn && !fn.includes('/') ? fn.replace(/^async /, '') : null });
  }
  return frames;
}

// Prisma says where in the code the failing query is: "Invalid `prisma.x.findMany()` invocation in
// /abs/path/file.js:87:15:". Only the place is taken from it, never the rest of the message.
function prismaCallSite(message) {
  const match = String(message || '').split('\n').slice(0, 4).join('\n').match(/invocation in\s+(\S+?):(\d+):(\d+)/);
  if (!match || !match[1].startsWith(APP_CODE)) return null;
  return `${path.relative(BACKEND_ROOT, match[1]).split(path.sep).join('/')}:${match[2]}:${match[3]}`;
}

// What Prisma tells about the schema (a column or table name, the fields of a constraint) is safe;
// what it tells about data is not, so only those keys are read, and only plain identifiers.
const SAFE_META_KEYS = ['column', 'table', 'modelName', 'target', 'field_name', 'constraint'];
const IDENTIFIER = /^[A-Za-z0-9_.]{1,80}$/;
function schemaDetails(error) {
  const meta = error?.meta;
  if (!meta || typeof meta !== 'object') return [];
  const details = [];
  for (const key of SAFE_META_KEYS) {
    const value = meta[key];
    const values = Array.isArray(value) ? value : [value];
    if (values.length > 0 && values.length <= 6 && values.every((v) => typeof v === 'string' && IDENTIFIER.test(v))) details.push(`${key}: ${values.join(', ')}`);
  }
  return details;
}

// Everything an alert says about an error, none of it from its message
function describeError(error) {
  if (!error) return null;
  const frames = appFrames(error.stack);
  // For a failing query Prisma names the exact line of the call, which beats the frame of the
  // function that was awaiting it
  const callSite = prismaCallSite(error.message);
  const location = callSite ?? frames[0]?.where ?? null;
  return {
    name: String(error.name || 'Error').slice(0, 80),
    code: typeof error.code === 'string' ? error.code.slice(0, 40) : undefined,
    location,
    fn: (callSite ? frames.find((frame) => frame.where.startsWith(callSite.replace(/:\d+:\d+$/, '')))?.fn : frames[0]?.fn) ?? null,
    frames: frames.slice(0, MAX_FRAMES),
    details: schemaDetails(error)
  };
}

// --- Which clinic, which domain ----------------------------------------------------------------

// The clinic is the one of the signed-in account (`req.clinicId`, set by the auth middleware): all
// the clinics share one domain today, so the domain alone could not tell them apart. A request
// with no session (a login, a sign-up) has none.
const findClinicInDatabase = (id) => prisma.clinic.findUnique({ where: { id }, select: { name: true, slug: true } });

const oneLine = (text, max) => String(text).replace(/\s+/g, ' ').trim().slice(0, max);

// The domain the app was used from: the browser sends it as `Origin` on every call to the API, so
// when each clinic has a domain of its own (https://clinica.example) it names the clinic too. Only
// a real scheme://host[:port] is taken, nothing else a client could put in a header.
function originOf(value) {
  try {
    const url = new URL(String(value));
    if (!/^https?:$/.test(url.protocol) || !/^[A-Za-z0-9.-]+$/.test(url.hostname)) return null;
    return `${url.protocol}//${url.host}`.slice(0, 120);
  } catch {
    return null;
  }
}

// --- The alert ---------------------------------------------------------------------------------

// Where a route pattern starts inside the real path: "/api/things/thrown/42" with "/thrown/:id"
// starts after "/api/things". Express forgets the router's own prefix (`req.baseUrl`) once an error
// leaves it, but the real path is still there.
const prefixBefore = (requestPath, pattern) => {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : `\\${c}`));
  const regex = new RegExp(`${escaped.replace(/:[A-Za-z0-9_]+/g, '[^/]+')}/?$`);
  const match = requestPath.match(regex);
  return match ? requestPath.slice(0, match.index) : '';
};

// "/api/appointments/:id": the router that matched plus the route pattern, never the real path
const routePattern = (req) => {
  // A route can answer to several paths (`['/doctors', '/medicos']`): the first names it
  const pattern = Array.isArray(req.route?.path) ? req.route.path[0] : req.route?.path;
  if (typeof pattern !== 'string') return req.baseUrl || '(no route matched)';
  const base = req.baseUrl || prefixBefore(String(req.originalUrl || '').split('?')[0], pattern);
  return `${base}${pattern === '/' ? '' : pattern}` || '/';
};

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// What the alert says about whose request it was: { name, slug, id, lookupFailed } or null (no session)
function clinicLine(clinic) {
  if (!clinic) return 'Consultorio: no identificado (la petición no tenía sesión iniciada)';
  if (!clinic.name) return `Consultorio: id ${clinic.id} (no se pudo consultar su nombre)`;
  return `Consultorio: ${clinic.name} (${clinic.slug}) · id ${clinic.id}`;
}

function buildAlert({ method, route, status, error, requestId, clinic, origin, apiOrigin, held, env }) {
  const where = `${method} ${route}`;
  const lines = [
    `MedCita devolvió un error ${status} en ${where}.`,
    clinicLine(clinic),
    origin ? `Dominio desde el que se usó la app: ${origin}` : null,
    apiOrigin ? `Servidor que respondió: ${apiOrigin}` : null,
    error?.name ? `Tipo de error: ${error.name}${error.code ? ` (${error.code})` : ''}` : null,
    error?.location ? `Línea del código: ${error.location}${error.fn ? ` (en ${error.fn})` : ''}` : error ? 'No se pudo determinar la línea del código (el error no pasó por código de MedCita).' : 'La ruta atendió el error sin dejar rastro: el detalle está en los logs.',
    ...(error?.details || []).map((detail) => `Detalle del esquema: ${detail}`),
    error?.frames?.length > 1 ? `Pila (solo código de MedCita):\n${error.frames.map((frame) => `  ${frame.where}${frame.fn ? ` (${frame.fn})` : ''}`).join('\n')}` : null,
    held > 0 ? `Desde el último aviso de esta ruta hubo ${held} error${held === 1 ? '' : 'es'} más.` : null,
    `Servicio: ${env.RENDER_SERVICE_NAME || 'local'}${env.RENDER_GIT_COMMIT ? ` · versión ${String(env.RENDER_GIT_COMMIT).slice(0, 7)}` : ''}`,
    `Hora (UTC): ${new Date().toISOString()}`,
    requestId ? `Id de la petición: ${requestId} — búscalo en los logs de Render para ver el mensaje completo del error.` : 'Revisa los logs del servicio en Render para ver el mensaje completo del error.',
    'Este aviso no incluye datos de pacientes ni de la petición, ni el mensaje del error.'
  ].filter(Boolean);
  const html = `<div style="font-family: Arial, sans-serif; max-width: 560px; color: #1e293b;"><h2 style="margin: 0 0 12px;">Error ${escapeHtml(status)} en MedCita</h2>${lines
    .map((line) => `<p style="margin: 8px 0; white-space: pre-wrap;${line.startsWith('Línea del código') || line.startsWith('Consultorio') ? ' font-weight: bold;' : ''}">${escapeHtml(line)}</p>`)
    .join('')}</div>`;
  const place = error?.location ? ` (${error.location.replace(/:\d+$/, '')})` : '';
  const who = clinic?.name ? ` · ${oneLine(clinic.name, 50)}` : '';
  return { subject: `[MedCita${who}] Error ${status} en ${where}${place}`, text: lines.join('\n'), html };
}

/**
 * Builds the alerting: `middleware` (gives each request its id and its error memory, and watches
 * the response), `errorHandler` (the last Express handler: logs an error nobody caught and answers
 * 500) and `report` (what they call). `send` and `now` can be replaced, for tests.
 */
function createErrorAlerts({ env = process.env, send = (...args) => emailService.deliverEmail(...args), now = Date.now, findClinic = findClinicInDatabase } = {}) {
  const lastByRoute = new Map(); // route -> { at, held }
  let sentAt = []; // when the alerts of the last hour were sent

  // `clinicId` is the clinic of the request (if it had a session); each clinic has its own count for a
  // route, so a route failing for two clinics tells both, while one failing over and over tells one.
  async function report({ method, route, status, error, requestId, clinicId, origin, apiOrigin }) {
    const recipients = recipientsOf(env);
    if (recipients.length === 0) return false;

    const time = now();
    const key = `${method} ${route} ${clinicId || ''}`;
    const entry = lastByRoute.get(key) || { at: -Infinity, held: 0 };
    sentAt = sentAt.filter((at) => time - at < HOUR);

    // Held back: this route was alerted not long ago, or the platform already sent plenty this hour
    if (time - entry.at < MIN_MINUTES_PER_ROUTE * MINUTE || sentAt.length >= MAX_ALERTS_PER_HOUR) {
      lastByRoute.set(key, { ...entry, held: entry.held + 1 });
      return false;
    }

    lastByRoute.set(key, { at: time, held: 0 });
    sentAt.push(time);
    // The name of the clinic is looked up now: if the database is the thing that is failing, the alert
    // still goes out, with the id alone
    let clinic = null;
    if (clinicId) {
      clinic = { id: clinicId };
      try {
        const found = await findClinic(clinicId);
        if (found) clinic = { ...found, id: clinicId };
      } catch {
        // keep the id
      }
    }
    const alert = buildAlert({ method, route, status, error, requestId, clinic, origin, apiOrigin, held: entry.held, env });
    await Promise.all(recipients.map((to) => send(to, alert.subject, alert.text, alert.html)));
    return true;
  }

  // Gives the request an id (also sent back in the X-Request-Id header, and printed in front of its
  // error log lines) and watches the response: when it ends in a 5xx, tell whoever runs the platform.
  // Registered before the routes, it reports after the response has gone out, so it never slows the
  // user down.
  function middleware(req, res, next) {
    const context = newRequestContext();
    res.setHeader('X-Request-Id', context.id);
    res.on('finish', () => {
      if (res.statusCode < 500 || SKIPPED_PATHS.includes(req.path)) return;
      report({
        method: req.method,
        route: routePattern(req),
        status: res.statusCode,
        error: describeError(context.errors[0]),
        requestId: context.id,
        // set by the auth middleware, which runs after this one: read when the response is done
        clinicId: typeof req.clinicId === 'string' ? req.clinicId : undefined,
        origin: originOf(req.get('origin')),
        apiOrigin: originOf(`${req.protocol}://${req.get('host')}`)
      }).catch((err) => {
        console.error('Could not send the error alert:', err.message);
      });
    });
    requests.run(context, next);
  }

  // The last handler of the app: an error thrown (or passed to next) that no route dealt with ends here
  // instead of showing Express's own page, and is kept for the alert.
  // eslint-disable-next-line no-unused-vars
  function errorHandler(err, req, res, next) {
    const context = requests.getStore();
    if (context && err instanceof Error && !context.errors.includes(err)) context.errors.push(err);
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    const clientError = err?.status >= 400 && err.status < 500;
    res.status(clientError ? err.status : 500).json({ error: clientError && err.expose ? err.message : 'An unexpected error occurred' });
  }

  return { middleware, errorHandler, report };
}

installConsoleCapture();

module.exports = {
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
};
