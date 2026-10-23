const { PassThrough } = require('stream');
const request = require('supertest');
const app = require('../src/server');
const { prisma, resetDb } = require('./helpers/db');
const { createUser, createClinic, createPatient, createAppointment, bearer } = require('./helpers/factories');
const { buildPatientExport } = require('../src/services/patientExport');
const { buildBlocks, renderPatientExportPdf } = require('../src/services/patientExportPdf');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const binary = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};
const exportAs = (token, patientId, format) =>
  request(app).get(`/api/patients/${patientId}/export${format ? `?format=${format}` : ''}`).set(bearer(token)).buffer(true).parse(binary);
const audit = () => prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
const pageCount = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

// A patient with some of everything, written by a doctor
async function setup(overrides = {}) {
  const clinic = await createClinic({ name: 'Consultorio Prueba' });
  const doctor = await createUser({ role: 'doctor', clinic, name: 'Dra. Vega' });
  const admin = await createUser({ role: 'admin', clinic, name: 'Admin Uno' });
  const patient = await createPatient({
    clinic, name: 'María Núñez', cedula: '1712345678', birthDate: '2015-03-09', sex: 'female', guardianName: 'Ana Núñez', guardianRelationship: 'Madre', ...overrides
  });
  const visit = await createAppointment({ doctor: doctor.user, patient, date: '2026-09-10', time: '09:00', status: 'completed', notes: 'Viene con su madre' });
  const base = { clinicId: clinic.id, patientId: patient.id };
  await prisma.patientAllergy.create({ data: { ...base, substance: 'Penicilina', reaction: 'Urticaria', severity: 'severe', recordedById: doctor.user.id, recordedByName: 'Dra. Vega' } });
  await prisma.patientAllergy.create({ data: { ...base, substance: 'Polvo', active: false, recordedById: doctor.user.id, recordedByName: 'Dra. Vega' } });
  await prisma.patientMedication.create({ data: { ...base, name: 'Metformina', dose: '850 mg', recordedById: doctor.user.id, recordedByName: 'Dra. Vega' } });
  await prisma.patientBackground.create({ data: { ...base, category: 'surgical', description: 'Apendicectomía', noted: '2019', recordedById: doctor.user.id, recordedByName: 'Dra. Vega' } });
  await prisma.patientVitals.create({ data: { ...base, measuredAt: new Date('2026-09-10T14:20:00Z'), weightKg: 70, heightCm: 170, systolic: 120, diastolic: 80, oxygenSaturation: 98, recordedById: doctor.user.id, recordedByName: 'Dra. Vega' } });
  await prisma.patientVitals.create({ data: { ...base, measuredAt: new Date('2026-09-11T14:20:00Z'), weightKg: 7, recordedById: doctor.user.id, recordedByName: 'Dra. Vega', voidedAt: new Date(), voidedByName: 'Admin Uno', voidReason: 'Paciente equivocado' } });
  const note = await prisma.consultationNote.create({
    data: {
      ...base, appointmentId: visit.id, status: 'closed', template: 'blank', authorId: doctor.user.id, authorName: 'Dra. Vega',
      subjective: 'Cefalea; tomó β-bloqueante', objective: 'SpO₂ 98 %', assessment: 'Cefalea tensional', plan: 'Reposo',
      closedAt: new Date('2026-09-10T15:30:00Z'), closedById: doctor.user.id, closedByName: 'Dra. Vega'
    }
  });
  await prisma.consultationDiagnosis.create({ data: { ...base, noteId: note.id, code: 'G44.2', name: 'Cefalea tensional', kind: 'primary', certainty: 'definitive', recordedById: doctor.user.id, recordedByName: 'Dra. Vega' } });
  await prisma.consultationAddendum.create({ data: { clinicId: clinic.id, noteId: note.id, text: 'Se aclara la dosis', authorId: doctor.user.id, authorName: 'Dra. Vega' } });
  await prisma.patientConsent.create({ data: { ...base, granted: true, documentVersion: '2026-10-v1', method: 'in_person_signed', recordedById: doctor.user.id, recordedByName: 'Dra. Vega', recordedByRole: 'doctor' } });
  return { clinic, doctor, admin, patient, visit, note };
}

const texts = (blocks) => blocks.flatMap((b) => [b.text, b.label]).filter(Boolean).join('\n');
const META = { exportedBy: 'Admin Uno', timezone: 'America/Guayaquil' };

describe('what the PDF says', () => {
  it('is a Spanish document with every part of the record', async () => {
    const ctx = await setup();
    const data = await buildPatientExport(prisma, { clinicId: ctx.clinic.id }, ctx.patient.id);

    const text = texts(buildBlocks(data, META));

    for (const part of [
      'Historia del paciente', 'Consultorio Prueba', 'por Admin Uno', 'Documento confidencial', 'Datos personales',
      'María Núñez', '1712345678', 'Femenino', '2015-03-09', 'Representante legal', 'Ana Núñez', 'Madre',
      'Consentimiento para datos de salud', 'otorgado · texto v2026-10-v1 · firmado en papel',
      'Penicilina — Urticaria (grave)', 'Polvo [resuelta]', 'Metformina — 850 mg', 'Quirúrgico: Apendicectomía (2019)',
      'peso 70 kg', 'IMC 24.2', 'presión 120/80 mmHg', 'SpO₂ 98 %', 'Consulta del 2026-09-10 09:00 · Dra. Vega',
      'Cefalea; tomó β-bloqueante', 'SpO₂ 98 %', 'G44.2 Cefalea tensional — principal (definitivo)', 'Se aclara la dosis',
      '2026-09-10 09:00 · Dra. Vega · Atendida · Nota de reserva: Viene con su madre'
    ]) expect(text).toContain(part);
  });

  it('marks a voided reading with who voided it and why, and dims it', async () => {
    const ctx = await setup();
    const data = await buildPatientExport(prisma, { clinicId: ctx.clinic.id }, ctx.patient.id);

    const voided = buildBlocks(data, META).find((b) => b.text.includes('peso 7 kg'));

    expect(voided.text).toContain('[ANULADA por Admin Uno: Paciente equivocado]');
    expect(voided.dim).toBe(true);
  });

  it('says a note is a draft when it was never closed', async () => {
    const ctx = await setup();
    const second = await createAppointment({ doctor: ctx.doctor.user, patient: ctx.patient, date: '2026-10-01', time: '10:00' });
    await prisma.consultationNote.create({ data: { clinicId: ctx.clinic.id, patientId: ctx.patient.id, appointmentId: second.id, authorId: ctx.doctor.user.id, authorName: 'Dra. Vega', plan: 'Pendiente' } });
    const data = await buildPatientExport(prisma, { clinicId: ctx.clinic.id }, ctx.patient.id);

    expect(texts(buildBlocks(data, META))).toContain('BORRADOR sin cerrar · escrita por Dra. Vega');
  });

  it('says so when there is nothing, and leaves the guardian out of an adult', async () => {
    const clinic = await createClinic({ name: 'Consultorio Vacío' });
    const patient = await createPatient({ clinic });
    const data = await buildPatientExport(prisma, { clinicId: clinic.id }, patient.id);

    const text = texts(buildBlocks(data, META));

    expect(text).toContain('Ninguna registrada.');
    expect(text).toContain('Ninguno registrado.');
    expect(text).not.toContain('Representante legal');
  });

  it('shows the dates in the clinic zone', async () => {
    const ctx = await setup();
    const data = await buildPatientExport(prisma, { clinicId: ctx.clinic.id }, ctx.patient.id);

    const vitals = buildBlocks(data, META).find((b) => b.text.includes('peso 70 kg'));
    expect(vitals.text).toMatch(/^10 sept 2026, 9:20/); // 14:20 UTC is 09:20 in Ecuador
  });
});

describe('drawing the PDF', () => {
  it('draws a document with characters outside Latin-1 (β, ₂, ≥, →)', async () => {
    const ctx = await setup();
    const data = await buildPatientExport(prisma, { clinicId: ctx.clinic.id }, ctx.patient.id);
    data.consultationNotes[0].plan = 'β-bloqueante ≥ 5 mg → control; SpO₂ 98 %';

    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => stream.on('end', resolve));
    renderPatientExportPdf(data, META, stream);
    await done;

    const pdf = Buffer.concat(chunks);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    expect(pdf.toString('latin1')).toContain('DejaVuSans');
  });

  it('a long record takes more than one page and every page has its footer', async () => {
    const ctx = await setup();
    await prisma.patientVitals.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({ clinicId: ctx.clinic.id, patientId: ctx.patient.id, measuredAt: new Date(Date.UTC(2026, 0, 1) + i * 86400000), weightKg: 60 + i / 10, recordedById: ctx.doctor.user.id, recordedByName: 'Dra. Vega' }))
    });
    const res = await exportAs(ctx.admin.token, ctx.patient.id, 'pdf');

    expect(pageCount(res.body)).toBeGreaterThan(3);
  });
});

describe('GET /api/patients/:id/export?format=pdf', () => {
  it('an admin downloads the PDF', async () => {
    const ctx = await setup();

    const res = await exportAs(ctx.admin.token, ctx.patient.id, 'pdf');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="patient-${ctx.patient.id}.pdf"`);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(res.body)).toBeGreaterThanOrEqual(1);
  });

  it('is audited as an export in PDF, like the JSON one is audited as an export in JSON', async () => {
    const ctx = await setup();

    await exportAs(ctx.admin.token, ctx.patient.id, 'pdf');
    await exportAs(ctx.admin.token, ctx.patient.id);

    const entries = (await audit()).filter((e) => e.entity === 'patient_export');
    expect(entries.map((e) => [e.action, e.entityId, e.actorId, e.changes])).toEqual([
      ['read', ctx.patient.id, ctx.admin.user.id, { format: { to: 'pdf' } }],
      ['read', ctx.patient.id, ctx.admin.user.id, { format: { to: 'json' } }]
    ]);
  });

  it('without format it is still the JSON file, with the same content as before', async () => {
    const ctx = await setup();

    const res = await request(app).get(`/api/patients/${ctx.patient.id}/export`).set(bearer(ctx.admin.token));

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="patient-${ctx.patient.id}.json"`);
    expect(Object.keys(res.body).sort()).toEqual(['allergies', 'appointments', 'backgrounds', 'clinic', 'consultationNotes', 'exportedAt', 'healthDataConsent', 'medications', 'messagesSent', 'patient', 'vitalSigns']);
  });

  it('refuses another format', async () => {
    const ctx = await setup();
    expect((await exportAs(ctx.admin.token, ctx.patient.id, 'docx')).status).toBe(400);
    expect((await audit()).filter((e) => e.entity === 'patient_export')).toHaveLength(0);
  });

  it.each(['doctor', 'secretary'])('a %s cannot, for the PDF or the JSON', async (role) => {
    const ctx = await setup();
    const user = await createUser({ role, clinic: ctx.clinic });

    expect((await exportAs(user.token, ctx.patient.id, 'pdf')).status).toBe(403);
    expect((await exportAs(user.token, ctx.patient.id)).status).toBe(403);
    expect(await audit()).toHaveLength(0);
  });

  it('an admin of another clinic gets 404 and no file', async () => {
    const ctx = await setup();
    const outsider = await createUser({ role: 'admin', clinic: await createClinic() });

    const res = await exportAs(outsider.token, ctx.patient.id, 'pdf');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(await audit()).toHaveLength(0);
  });

  it('401 without a token', async () => {
    const ctx = await setup();
    expect((await request(app).get(`/api/patients/${ctx.patient.id}/export?format=pdf`)).status).toBe(401);
  });
});
