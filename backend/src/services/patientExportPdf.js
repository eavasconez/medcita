const path = require('path');
const PDFDocument = require('pdfkit');
const { bmiOf } = require('./vitals');

// The PDF of the export of a patient's data (S10-07): the same content as the JSON file
// (services/patientExport.js), laid out to be read. It is a document for the patient, so it is
// written in Spanish. The font is DejaVu Sans (src/assets/fonts, with its licence) because the
// standard PDF fonts only print Latin-1: a "β-bloqueante" or "SpO₂" typed by a doctor would not
// come out.

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const REGULAR = 'Body';
const BOLD = 'Bold';
const COLORS = { text: '#0f172a', muted: '#64748b', line: '#cbd5e1', accent: '#0369a1', warn: '#b45309' };

const SEX = { female: 'Femenino', male: 'Masculino', other: 'Otro' };
const APPOINTMENT_STATUS = {
  pending_approval: 'Pendiente', scheduled: 'Agendada', confirmed: 'Confirmada', arrived: 'Llegó', in_progress: 'En consulta',
  completed: 'Atendida', no_show: 'No asistió', cancelled: 'Cancelada'
};
const SEVERITY = { mild: 'leve', moderate: 'moderada', severe: 'grave' };
const BACKGROUND = { personal: 'Personal', family: 'Familiar', surgical: 'Quirúrgico', habit: 'Hábitos' };
const CERTAINTY = { presumptive: 'presuntivo', definitive: 'definitivo' };
const CONSENT_STATUS = { none: 'Sin registrar', granted: 'Otorgado', withdrawn: 'Retirado' };
const CONSENT_METHOD = { in_person_signed: 'firmado en papel', in_person_verbal: 'verbal, en persona', electronic: 'en pantalla', other: 'otro' };
const MESSAGE_KIND = {
  appointment_confirmation: 'Confirmación de cita', appointment_reminder: 'Recordatorio de cita', appointment_cancellation: 'Cancelación de cita',
  appointment_rescheduled: 'Cambio de cita'
};
const MESSAGE_STATUS = { sent: 'enviado', simulated: 'simulado', failed: 'falló', received: 'recibido', queued: 'en cola' };

// Dates as the clinic sees them (its own zone)
const formatters = (timezone) => ({
  dateTime: (value) => new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value)),
  date: (value) => new Intl.DateTimeFormat('es-EC', { dateStyle: 'long', timeZone: timezone }).format(new Date(value))
});

const orDash = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));

function describeVitals(v) {
  const parts = [];
  if (v.weightKg !== null) parts.push(`peso ${v.weightKg} kg`);
  if (v.heightCm !== null) parts.push(`talla ${v.heightCm} cm`);
  const bmi = bmiOf(v);
  if (bmi !== null) parts.push(`IMC ${bmi}`);
  if (v.systolic !== null) parts.push(`presión ${v.systolic}/${v.diastolic} mmHg`);
  if (v.heartRate !== null) parts.push(`FC ${v.heartRate} lpm`);
  if (v.respiratoryRate !== null) parts.push(`FR ${v.respiratoryRate} rpm`);
  if (v.temperatureC !== null) parts.push(`temperatura ${v.temperatureC} °C`);
  if (v.oxygenSaturation !== null) parts.push(`SpO₂ ${v.oxygenSaturation} %`);
  return parts.join(' · ');
}

// What the document says, as a list of blocks, apart from how it is drawn: so what goes into the
// PDF can be tested without reading a PDF. Block kinds: title, line (muted), warning, h2, h3,
// row (label, value), body (text), muted (text), label (small caps heading), gap.
function buildBlocks(data, meta) {
  const { dateTime, date } = formatters(meta.timezone);
  const blocks = [];
  const add = (kind, text, extra = {}) => blocks.push({ kind, text, ...extra });
  const row = (label, value) => blocks.push({ kind: 'row', label, text: orDash(value) });
  const p = data.patient;

  add('title', 'Historia del paciente');
  add('line', data.clinic);
  add('line', `Exportado el ${dateTime(data.exportedAt)} por ${meta.exportedBy}`);
  add('warning', 'Documento confidencial: contiene datos de salud.');

  add('h2', 'Datos personales');
  row('Nombre', p.name);
  row('Cédula', p.cedula);
  row('Teléfono', p.phone);
  row('Correo', p.email);
  row('Fecha de nacimiento', p.birthDate);
  row('Sexo', p.sex ? SEX[p.sex] || p.sex : null);
  row('Dirección', p.address);
  row('Ocupación', p.occupation);
  row('Contacto de emergencia', [p.emergencyContactName, p.emergencyContactPhone].filter(Boolean).join(' · ') || null);
  row('Seguro médico', [p.insuranceProvider, p.insuranceNumber].filter(Boolean).join(' · ') || null);
  row('Registrado el', date(p.createdAt));
  if (p.guardianName) {
    add('h3', 'Representante legal');
    row('Nombre', p.guardianName);
    row('Parentesco', p.guardianRelationship);
    row('Cédula', p.guardianCedula);
    row('Teléfono', p.guardianPhone);
  }

  add('h2', 'Consentimiento para datos de salud');
  row('Estado', CONSENT_STATUS[data.healthDataConsent.status] || data.healthDataConsent.status);
  row('Versión vigente del texto', data.healthDataConsent.currentVersion);
  for (const event of data.healthDataConsent.events) {
    add('body', `${dateTime(event.createdAt)} · ${event.granted ? 'otorgado' : 'retirado'} · texto v${event.documentVersion} · ${CONSENT_METHOD[event.method] || event.method} · registrado por ${event.recordedByName}`);
  }

  add('h2', 'Alergias');
  if (data.allergies.length === 0) add('muted', 'Ninguna registrada.');
  for (const a of data.allergies) {
    add('body', `• ${a.substance}${a.reaction ? ` — ${a.reaction}` : ''}${a.severity ? ` (${SEVERITY[a.severity]})` : ''}${a.active ? '' : ' [resuelta]'}`);
  }
  add('h2', 'Medicación habitual');
  if (data.medications.length === 0) add('muted', 'Ninguna registrada.');
  for (const m of data.medications) {
    const detail = [m.dose, m.frequency].filter(Boolean).join(', ');
    add('body', `• ${m.name}${detail ? ` — ${detail}` : ''}${m.active ? '' : ' [suspendida]'}`);
  }
  add('h2', 'Antecedentes');
  if (data.backgrounds.length === 0) add('muted', 'Ninguno registrado.');
  for (const b of data.backgrounds) {
    add('body', `• ${BACKGROUND[b.category] || b.category}: ${b.description}${b.noted ? ` (${b.noted})` : ''}`);
  }

  add('h2', 'Signos vitales');
  if (data.vitalSigns.length === 0) add('muted', 'Ninguno registrado.');
  for (const v of data.vitalSigns) {
    add('body', `${dateTime(v.measuredAt)} — ${describeVitals(v)}${v.voidedAt ? `  [ANULADA por ${v.voidedByName}${v.voidReason ? `: ${v.voidReason}` : ''}]` : ''}`, { dim: Boolean(v.voidedAt), gap: true });
  }

  add('h2', 'Notas de consulta');
  if (data.consultationNotes.length === 0) add('muted', 'Ninguna registrada.');
  const visits = new Map(data.appointments.map((a) => [a.id, a]));
  for (const note of data.consultationNotes) {
    const visit = visits.get(note.appointmentId);
    add('h3', visit ? `Consulta del ${visit.date} ${visit.time}${visit.doctor ? ` · ${visit.doctor}` : ''}` : 'Consulta');
    add('muted', `${note.status === 'closed' ? `Cerrada el ${dateTime(note.closedAt)} por ${note.closedByName}` : 'BORRADOR sin cerrar'} · escrita por ${note.authorName}`);
    for (const [label, key] of [['Subjetivo', 'subjective'], ['Objetivo', 'objective'], ['Análisis', 'assessment'], ['Plan', 'plan']]) {
      add('label', label.toUpperCase());
      add('body', note[key].trim() || '—');
    }
    if (note.diagnoses.length > 0) {
      add('label', 'DIAGNÓSTICOS');
      const ordered = [...note.diagnoses].sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary'));
      for (const d of ordered) add('body', `• ${d.code ? `${d.code} ` : ''}${d.name}${d.kind === 'primary' ? ' — principal' : ''} (${CERTAINTY[d.certainty] || d.certainty})`);
    }
    if (note.addenda.length > 0) {
      add('label', 'ADENDAS');
      for (const a of note.addenda) {
        add('body', a.text);
        add('muted', `${a.authorName} · ${dateTime(a.createdAt)}`);
      }
    }
  }

  add('h2', 'Citas');
  if (data.appointments.length === 0) add('muted', 'Ninguna.');
  for (const a of data.appointments) {
    add('body', `${a.date} ${a.time} · ${a.doctor} · ${APPOINTMENT_STATUS[a.status] || a.status}${a.notes ? ` · Nota de reserva: ${a.notes}` : ''}`);
  }

  add('h2', 'Mensajes enviados al paciente');
  add('muted', 'Se registra que se envió cada mensaje, no su texto. El destino va enmascarado.');
  if (data.messagesSent.length === 0) add('muted', 'Ninguno.');
  for (const m of data.messagesSent) {
    add('body', `${dateTime(m.createdAt)} · ${MESSAGE_KIND[m.kind] || m.kind} · ${m.channel} · ${MESSAGE_STATUS[m.status] || m.status} · ${orDash(m.destination)}`);
  }
  return blocks;
}

// Writes the document to `stream` (a response, a file...) and ends it.
// `data` is buildPatientExport's result; `meta`: { exportedBy, timezone }.
function renderPatientExportPdf(data, meta, stream) {
  const blocks = buildBlocks(data, meta);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 64, left: 54, right: 54 },
    bufferPages: true,
    info: { Title: `Historia de ${data.patient.name}`, Author: data.clinic, Subject: 'Exportación de los datos del paciente' }
  });
  doc.registerFont(REGULAR, path.join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont(BOLD, path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  doc.pipe(stream);

  const left = () => doc.page.margins.left;
  const width = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  // Text placed at an explicit x leaves the cursor there: every block starts at the left margin
  const ensure = (height) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    doc.x = left();
  };

  for (const block of blocks) {
    switch (block.kind) {
      case 'title':
        ensure(30);
        doc.font(BOLD).fontSize(18).fillColor(COLORS.text).text(block.text).moveDown(0.2);
        break;
      case 'line':
        ensure(14);
        doc.font(REGULAR).fontSize(10).fillColor(COLORS.muted).text(block.text);
        break;
      case 'warning':
        ensure(16);
        doc.moveDown(0.3).font(BOLD).fontSize(9).fillColor(COLORS.warn).text(block.text);
        break;
      case 'h2': {
        ensure(60);
        doc.moveDown(0.9).font(BOLD).fontSize(12).fillColor(COLORS.accent).text(block.text.toUpperCase(), { characterSpacing: 0.6 });
        const y = doc.y + 2;
        doc.moveTo(left(), y).lineTo(left() + width(), y).strokeColor(COLORS.line).lineWidth(0.7).stroke();
        doc.moveDown(0.5);
        break;
      }
      case 'h3':
        ensure(40);
        doc.moveDown(0.4).font(BOLD).fontSize(10.5).fillColor(COLORS.text).text(block.text);
        break;
      case 'row': {
        ensure(16);
        const y = doc.y;
        doc.font(BOLD).fontSize(9).fillColor(COLORS.muted).text(block.label, left(), y, { width: 150 });
        doc.font(REGULAR).fontSize(9.5).fillColor(COLORS.text).text(block.text, left() + 155, y, { width: width() - 155 });
        doc.x = left();
        break;
      }
      case 'label':
        ensure(30);
        doc.moveDown(0.3).font(BOLD).fontSize(9).fillColor(COLORS.muted).text(block.text, { characterSpacing: 0.5 });
        break;
      case 'muted':
        ensure(14);
        doc.font(REGULAR).fontSize(9.5).fillColor(COLORS.muted).text(block.text);
        break;
      default: // body
        ensure(14);
        doc.font(REGULAR).fontSize(9.5).fillColor(block.dim ? COLORS.muted : COLORS.text).text(block.text);
        if (block.gap) doc.moveDown(0.25);
    }
  }

  // The footer on every page, in the bottom margin
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    // without this pdfkit would start a new page for text placed in the margin
    doc.page.margins.bottom = 0;
    doc.font(REGULAR).fontSize(8).fillColor(COLORS.muted);
    const y = doc.page.height - 40;
    doc.text(`${data.clinic} · ${data.patient.name} · confidencial`, left(), y, { width: width() - 80, lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, left() + width() - 80, y, { width: 80, align: 'right', lineBreak: false });
  }

  doc.end();
}

module.exports = { renderPatientExportPdf, buildBlocks };
