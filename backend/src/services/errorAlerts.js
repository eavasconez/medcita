// A server error (500) is only visible in Render's logs, so one can go on for days unnoticed. This
// emails whoever runs the platform when a request ends in a 5xx (S9-08): which route, how often,
// what kind of error, never what was inside the request.
//
// What an alert never carries: the request body, the query string, the ids in the path (only the
// route pattern, like `/api/patients/:id`), who made the request, their IP, or the text of the
// error (an error message can quote a value that was being saved, such as a patient's name).
//
// It does not flood: one email per route every 15 minutes (counting the errors it held back, which
// the next one reports) and at most 10 in an hour for the whole platform. Turned on by naming the
// recipients in ERROR_ALERT_EMAILS (comma-separated); without it nothing is sent and the errors
// are only in the log, as before.

const emailService = require('./emailService');

const MIN_MINUTES_PER_ROUTE = 15;
const MAX_ALERTS_PER_HOUR = 10;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// A health check that says "not ready" (503) is for the uptime monitor, not for an email each time
const SKIPPED_PATHS = ['/api/health'];

const recipientsOf = (env) =>
  String(env.ERROR_ALERT_EMAILS || '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

// Where a route pattern starts inside the real path: "/api/things/thrown/42" with "/thrown/:id"
// starts after "/api/things". Express forgets the router's own prefix (`req.baseUrl`) once an error
// leaves it, but the real path is still there.
const prefixBefore = (path, pattern) => {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : `\\${c}`));
  const regex = new RegExp(`${escaped.replace(/:[A-Za-z0-9_]+/g, '[^/]+')}/?$`);
  const match = path.match(regex);
  return match ? path.slice(0, match.index) : '';
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

function buildAlert({ method, route, status, error, held, env }) {
  const where = `${method} ${route}`;
  const lines = [
    `MedCita devolvió un error ${status} en ${where}.`,
    error?.name ? `Tipo de error: ${error.name}${error.code ? ` (${error.code})` : ''}` : 'El error fue atendido por la propia ruta: el detalle está en los logs.',
    held > 0 ? `Desde el último aviso de esta ruta hubo ${held} error${held === 1 ? '' : 'es'} más.` : null,
    `Servicio: ${env.RENDER_SERVICE_NAME || 'local'}${env.RENDER_GIT_COMMIT ? ` · versión ${String(env.RENDER_GIT_COMMIT).slice(0, 7)}` : ''}`,
    `Hora (UTC): ${new Date().toISOString()}`,
    'Revisa los logs del servicio en Render. Este aviso no incluye datos de pacientes ni de la petición.'
  ].filter(Boolean);
  const html = `<div style="font-family: Arial, sans-serif; max-width: 520px; color: #1e293b;"><h2 style="margin: 0 0 12px;">Error ${escapeHtml(status)} en MedCita</h2>${lines.map((line) => `<p style="margin: 8px 0;">${escapeHtml(line)}</p>`).join('')}</div>`;
  return { subject: `[MedCita] Error ${status} en ${where}`, text: lines.join('\n'), html };
}

/**
 * Builds the alerting: `middleware` (watches every response), `errorHandler` (the last Express
 * handler: logs an error nobody caught and answers 500) and `report` (what they call). `send` and
 * `now` can be replaced, for tests.
 */
function createErrorAlerts({ env = process.env, send = (...args) => emailService.deliverEmail(...args), now = Date.now } = {}) {
  const lastByRoute = new Map(); // route -> { at, held }
  let sentAt = []; // when the alerts of the last hour were sent

  async function report({ method, route, status, error }) {
    const recipients = recipientsOf(env);
    if (recipients.length === 0) return false;

    const time = now();
    const key = `${method} ${route}`;
    const entry = lastByRoute.get(key) || { at: -Infinity, held: 0 };
    sentAt = sentAt.filter((at) => time - at < HOUR);

    // Held back: this route was alerted not long ago, or the platform already sent plenty this hour
    if (time - entry.at < MIN_MINUTES_PER_ROUTE * MINUTE || sentAt.length >= MAX_ALERTS_PER_HOUR) {
      lastByRoute.set(key, { ...entry, held: entry.held + 1 });
      return false;
    }

    lastByRoute.set(key, { at: time, held: 0 });
    sentAt.push(time);
    const alert = buildAlert({ method, route, status, error, held: entry.held, env });
    await Promise.all(recipients.map((to) => send(to, alert.subject, alert.text, alert.html)));
    return true;
  }

  // Watches every response: when one ends in a 5xx, tell whoever runs the platform. Registered before
  // the routes, it reports after the response has gone out, so it never slows the user down.
  function middleware(req, res, next) {
    res.on('finish', () => {
      if (res.statusCode < 500 || SKIPPED_PATHS.includes(req.path)) return;
      report({ method: req.method, route: routePattern(req), status: res.statusCode, error: res.locals.serverError }).catch((err) => {
        console.error('Could not send the error alert:', err.message);
      });
    });
    next();
  }

  // The last handler of the app: an error thrown (or passed to next) that no route dealt with ends here
  // instead of showing Express's own page, and is kept for the alert (its type, never its message).
  // eslint-disable-next-line no-unused-vars
  function errorHandler(err, req, res, next) {
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    res.locals.serverError = { name: err?.name || 'Error', code: err?.code && typeof err.code === 'string' ? err.code : undefined };
    res.status(err?.status >= 400 && err.status < 500 ? err.status : 500).json({ error: err?.status >= 400 && err.status < 500 && err.expose ? err.message : 'An unexpected error occurred' });
  }

  return { middleware, errorHandler, report };
}

module.exports = { createErrorAlerts, recipientsOf, routePattern, MIN_MINUTES_PER_ROUTE, MAX_ALERTS_PER_HOUR };
