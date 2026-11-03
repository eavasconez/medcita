const fs = require('fs');
const os = require('os');
const path = require('path');

// The built web app that the server hands out: a stand-in for frontend/dist. WEB_DIST is read when
// the server module loads, so it is set before the require.
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'medcita-dist-'));
fs.mkdirSync(path.join(dist, 'assets'));
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>MedCita</title><div id="root"></div>');
fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
process.env.WEB_DIST = dist;

const express = require('express');
const request = require('supertest');
const app = require('../src/server');
const { webApp } = require('../src/middleware/webApp');
const { prisma } = require('./helpers/db');

afterAll(async () => {
  fs.rmSync(dist, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('the web app served by the API', () => {
  it('answers the home page with the app, always asked for again', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it.each(['/privacy', '/data-deletion', '/login', '/patients/42/timeline'])('gives the app for the page address %s, so the router decides', async (route) => {
    const res = await request(app).get(route);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('keeps the files Vite names by their content for a year', async () => {
    const res = await request(app).get('/assets/index-abc123.js');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves the other files without keeping them', async () => {
    const res = await request(app).get('/favicon.svg');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('says 404 for a missing file instead of handing out the app as if it were that file', async () => {
    const res = await request(app).get('/assets/index-gone.js');

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<div id="root">');
  });

  it('leaves the API its own answers, also for a path it does not have', async () => {
    const health = await request(app).get('/api/health');
    const missing = await request(app).get('/api/no-such-route');
    const bare = await request(app).get('/api');

    expect(health.headers['content-type']).toMatch(/json/);
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('<div id="root">');
    expect(bare.status).toBe(404);
  });

  it('only gives the app to page requests, not to a POST', async () => {
    const res = await request(app).post('/patients');

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<div id="root">');
  });

  it('sends a content security policy that lets the app show its signed images and its PDFs', async () => {
    const policy = (await request(app).get('/')).headers['content-security-policy'];

    expect(policy).toMatch(/img-src 'self' data: blob: https:/);
    expect(policy).toMatch(/object-src 'self' blob:/);
    expect(policy).toMatch(/default-src 'self'/);
    expect(policy).toMatch(/script-src 'self'/);
  });
});

describe('webApp without a built app', () => {
  it('does nothing, so the API answers as it always did (local development)', async () => {
    const bare = express();
    bare.use(webApp({ dist: path.join(dist, 'nothing-here') }));

    const res = await request(bare).get('/');

    expect(res.status).toBe(404);
  });
});
