const storage = require('./fileStorage');

// What goes on the documents MedCita issues (S11-01): who issues them (the doctor and their
// professional registration) and from where (the clinic, with its logo). The text data lives in
// Doctor and Clinic; the logo, the signature and the seal are images in the private bucket and
// only their key is stored. Nothing here is required: a clinic without a logo or a doctor without a
// seal still gets a valid document, with what there is.

const MAX_IMAGE_BYTES = 500 * 1024;
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg' };
const MAX_TEXT = { title: 20, licenseNumber: 40, phone: 40, contactEmail: 120, address: 200, email: 120 };
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+\d][\d\s().-]{5,}$/;

// kind -> who owns it, the column that keeps its key and the file name in the bucket
const IMAGE_KINDS = {
  logo: { owner: 'clinic', column: 'logoKey' },
  signature: { owner: 'doctor', column: 'signatureKey' },
  seal: { owner: 'doctor', column: 'sealKey' }
};

// The kind of an image by its first bytes, not by what the browser says it is
function sniffImage(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  return null;
}

// A base64 image sent by the browser (with or without the "data:...;base64," prefix) -> a checked
// buffer, or an Error message for the person. Returns { error } or { buffer, ext, contentType }.
function parseImage(data) {
  if (typeof data !== 'string' || !data) return { error: 'An image is required' };
  const base64 = data.replace(/^data:[^;,]*;base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { error: 'The image is not valid' };
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) return { error: 'The image is empty' };
  if (buffer.length > MAX_IMAGE_BYTES) return { error: `The image is too large (maximum ${MAX_IMAGE_BYTES / 1024} KB)` };
  const ext = sniffImage(buffer);
  if (!ext) return { error: 'The image must be a PNG or a JPG' };
  return { buffer, ext, contentType: IMAGE_TYPES[ext] };
}

// Optional text fields of a profile: '' clears it. Returns { data } or { error }.
function cleanFields(body, allowed) {
  const data = {};
  for (const field of allowed) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== 'string') return { error: `${field} must be a string` };
    const value = body[field] === null ? '' : body[field].trim().replace(/\s+/g, ' ');
    if (value.length > MAX_TEXT[field]) return { error: `${field} must be at most ${MAX_TEXT[field]} characters` };
    if ((field === 'contactEmail' || field === 'email') && value && !EMAIL_REGEX.test(value)) return { error: `${field} is not a valid email` };
    if (field === 'phone' && value && !PHONE_REGEX.test(value)) return { error: 'phone is not a valid phone number' };
    data[field] = value || null;
  }
  return { data };
}

// The key of an image in the bucket. A new key each time, so a replaced image is never read from
// a stale copy and the old file can be deleted after the switch.
const imageKey = (clinicId, kind, ownerId, ext) => storage.clinicKey(clinicId, 'letterhead', `${kind}-${ownerId}-${Date.now()}.${ext}`);

// The data for one document: clinic, doctor and their images (as buffers, or null). Never throws
// because of an image: a bucket that is down or a deleted file just leaves it out.
async function loadLetterhead(db, clinicId, doctorId) {
  const [clinic, doctor] = await Promise.all([
    db.clinic.findUnique({ where: { id: clinicId }, select: { name: true, address: true, phone: true, email: true, logoKey: true } }),
    db.doctor.findFirst({ where: { id: doctorId, clinicId }, select: { name: true, title: true, specialty: true, licenseNumber: true, phone: true, contactEmail: true, signatureKey: true, sealKey: true } })
  ]);
  const images = { logo: null, signature: null, seal: null };
  if (storage.isConfigured()) {
    const keys = { logo: clinic?.logoKey, signature: doctor?.signatureKey, seal: doctor?.sealKey };
    await Promise.all(Object.entries(keys).map(async ([kind, key]) => {
      if (!key) return;
      try {
        images[kind] = await storage.getFile(clinicId, key);
      } catch (err) {
        console.error(`Letterhead image "${kind}" could not be read:`, err.message);
      }
    }));
  }
  const { logoKey, ...clinicData } = clinic || {};
  const { signatureKey, sealKey, ...doctorData } = doctor || {};
  return { clinic: clinicData, doctor: doctorData, images };
}

// What the settings screen needs: the text, which images exist and whether they can be kept at all
function present(clinic, doctor) {
  return {
    storageConfigured: storage.isConfigured(),
    clinic: { name: clinic.name, address: clinic.address, phone: clinic.phone, email: clinic.email, hasLogo: Boolean(clinic.logoKey) },
    doctor: {
      name: doctor.name, specialty: doctor.specialty, title: doctor.title, licenseNumber: doctor.licenseNumber,
      phone: doctor.phone, contactEmail: doctor.contactEmail, hasSignature: Boolean(doctor.signatureKey), hasSeal: Boolean(doctor.sealKey)
    }
  };
}

module.exports = { MAX_IMAGE_BYTES, IMAGE_KINDS, parseImage, cleanFields, imageKey, loadLetterhead, present, sniffImage };
