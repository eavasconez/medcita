const path = require('path');
const PDFDocument = require('pdfkit');

// The letterhead and the closing of a document (S11-01), drawn the same way for every PDF that
// leaves MedCita for a patient: S11-02 (prescriptions), S11-03 (certificates) and S11-04 (orders)
// use these functions. Spanish, DejaVu Sans (the standard PDF fonts only print Latin-1).

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const REGULAR = 'Body';
const BOLD = 'Bold';
const COLORS = { text: '#0f172a', muted: '#64748b', line: '#cbd5e1', accent: '#0369a1' };
const MARGIN = 50;
const LOGO_BOX = [64, 64];

function createDocument(info = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info });
  doc.registerFont(REGULAR, path.join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont(BOLD, path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  doc.font(REGULAR).fontSize(10).fillColor(COLORS.text);
  return doc;
}

// Draws an image that may be damaged without failing the whole document
function safeImage(doc, buffer, x, y, options) {
  if (!buffer) return false;
  try {
    doc.image(buffer, x, y, options);
    return true;
  } catch (err) {
    console.error('A letterhead image could not be drawn:', err.message);
    return false;
  }
}

const doctorLine = (doctor) => [doctor.title, doctor.name].filter(Boolean).join(' ');

// The lines of text of the letterhead, apart from how they are drawn (so they can be tested)
function headerLines(lh) {
  const { clinic, doctor } = lh;
  const clinicLines = [clinic.name, clinic.address, [clinic.phone, clinic.email].filter(Boolean).join(' · ')].filter(Boolean);
  const doctorLines = [
    doctorLine(doctor),
    doctor.specialty,
    doctor.licenseNumber ? `Registro profesional: ${doctor.licenseNumber}` : null,
    [doctor.phone, doctor.contactEmail].filter(Boolean).join(' · ')
  ].filter(Boolean);
  return { clinicLines, doctorLines };
}

// The top of the first page: the logo and the clinic on the left, the doctor on the right
function drawHeader(doc, lh) {
  const { clinicLines, doctorLines } = headerLines(lh);
  const top = MARGIN;
  const textLeft = MARGIN + (lh.images.logo ? LOGO_BOX[0] + 14 : 0);
  const width = doc.page.width - 2 * MARGIN;
  const columnWidth = (width - (textLeft - MARGIN)) / 2 - 8;

  const drewLogo = safeImage(doc, lh.images.logo, MARGIN, top, { fit: LOGO_BOX });
  const left = drewLogo ? textLeft : MARGIN;
  doc.font(BOLD).fontSize(13).fillColor(COLORS.accent).text(clinicLines[0] || '', left, top, { width: columnWidth });
  doc.font(REGULAR).fontSize(8.5).fillColor(COLORS.muted);
  clinicLines.slice(1).forEach((line) => doc.text(line, left, doc.y, { width: columnWidth }));
  const leftEnd = doc.y;

  const rightX = MARGIN + width - columnWidth;
  doc.font(BOLD).fontSize(10).fillColor(COLORS.text).text(doctorLines[0] || '', rightX, top, { width: columnWidth, align: 'right' });
  doc.font(REGULAR).fontSize(8.5).fillColor(COLORS.muted);
  doctorLines.slice(1).forEach((line) => doc.text(line, rightX, doc.y, { width: columnWidth, align: 'right' }));

  const bottom = Math.max(leftEnd, doc.y, drewLogo ? top + LOGO_BOX[1] : 0) + 10;
  doc.moveTo(MARGIN, bottom).lineTo(doc.page.width - MARGIN, bottom).strokeColor(COLORS.line).lineWidth(0.8).stroke();
  doc.x = MARGIN;
  doc.y = bottom + 16;
  doc.font(REGULAR).fontSize(10).fillColor(COLORS.text);
}

// The signature and the seal of the doctor, with their name and registration under them
function drawSignature(doc, lh) {
  const { doctor } = lh;
  if (doc.y > doc.page.height - MARGIN - 130) doc.addPage();
  const x = doc.page.width - MARGIN - 200;
  const y = doc.y + 24;
  safeImage(doc, lh.images.seal, x - 76, y - 10, { fit: [70, 70] });
  safeImage(doc, lh.images.signature, x + 20, y - 6, { fit: [160, 56] });
  doc.moveTo(x, y + 52).lineTo(x + 200, y + 52).strokeColor(COLORS.line).lineWidth(0.8).stroke();
  doc.font(BOLD).fontSize(9).fillColor(COLORS.text).text(doctorLine(doctor), x, y + 57, { width: 200, align: 'center' });
  if (doctor.licenseNumber) doc.font(REGULAR).fontSize(8).fillColor(COLORS.muted).text(`Registro profesional: ${doctor.licenseNumber}`, x, doc.y, { width: 200, align: 'center' });
  doc.font(REGULAR).fontSize(10).fillColor(COLORS.text);
}

// "Página N de M" and the date on every page, once the pages are known
function drawFooters(doc, { timezone = 'America/Guayaquil', issuedAt = new Date() } = {}) {
  const { start, count } = doc.bufferedPageRange();
  const date = new Intl.DateTimeFormat('es-EC', { dateStyle: 'long', timeZone: timezone }).format(issuedAt);
  for (let i = start; i < start + count; i += 1) {
    doc.switchToPage(i);
    doc.font(REGULAR).fontSize(8).fillColor(COLORS.muted);
    // Written below the bottom margin on purpose: with the default margin pdfkit would open a page
    const y = doc.page.height - MARGIN + 14;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.text(`${date} · Página ${i - start + 1} de ${count}`, MARGIN, y, { width: doc.page.width - 2 * MARGIN, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// A sample document to see the letterhead as it will come out: the header, a placeholder body
// and the signature. Used by the settings screen ("Preview letterhead").
async function renderPreview(lh, options = {}) {
  const doc = createDocument({ Title: 'Vista previa del membrete' });
  drawHeader(doc, lh);
  doc.font(BOLD).fontSize(14).text('Vista previa del membrete', { align: 'center' });
  doc.moveDown();
  doc.font(REGULAR).fontSize(10).fillColor(COLORS.muted).text(
    'Así se verán los datos del consultorio y del médico en las recetas, los certificados y las órdenes. Este texto es solo de ejemplo.',
    { align: 'center' }
  );
  doc.moveDown(6);
  doc.fillColor(COLORS.text);
  drawSignature(doc, lh);
  drawFooters(doc, options);
  return toBuffer(doc);
}

module.exports = { createDocument, drawHeader, drawSignature, drawFooters, toBuffer, headerLines, renderPreview, MARGIN, COLORS, REGULAR, BOLD };
