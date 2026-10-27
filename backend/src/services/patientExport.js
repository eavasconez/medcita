const { inClinic } = require('../utils/clinicScope');
const consents = require('./patientConsent');
const { CURRENT_CONSENT_VERSION } = require('../legal/healthDataConsent');
const { PROFILE_FIELDS } = require('./patientRecord');

// Everything MedCita holds about one patient, as one object: what the file download (JSON) and
// the PDF of the export of a patient's data (S8-07, S10-07) are made from. The messages are
// listed without their text (it is never stored) and with the destination masked. `null` when the
// patient is not in the caller's clinic. The caller has checked who may export and writes the
// audit entry.
async function buildPatientExport(db, req, patientId) {
  const patient = await db.patient.findFirst({
    where: inClinic(req, { id: patientId }),
    include: {
      appointments: { orderBy: [{ date: 'asc' }, { time: 'asc' }], include: { doctor: { select: { name: true } } } },
      clinic: { select: { name: true } }
    }
  });
  if (!patient) return null;

  const messages = await db.notificationLog.findMany({
    where: { clinicId: req.clinicId, recipient: 'patient', appointmentId: { in: patient.appointments.map((a) => a.id) } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, kind: true, channel: true, status: true, destination: true, appointmentId: true }
  });
  const consentHistory = await consents.history(req.clinicId, patient.id);
  const clinicalWhere = { patientId: patient.id, clinicId: req.clinicId };
  const [allergies, medications, backgrounds] = await Promise.all([
    db.patientAllergy.findMany({ where: clinicalWhere, orderBy: { createdAt: 'asc' } }),
    db.patientMedication.findMany({ where: clinicalWhere, orderBy: { createdAt: 'asc' } }),
    db.patientBackground.findMany({ where: clinicalWhere, orderBy: { createdAt: 'asc' } })
  ]);
  const vitalSigns = await db.patientVitals.findMany({ where: clinicalWhere, orderBy: [{ measuredAt: 'asc' }, { createdAt: 'asc' }] });
  const consultationNotes = await db.consultationNote.findMany({
    where: clinicalWhere,
    // By the day of the visit, not by when the note was written (a note can be written later)
    orderBy: [{ appointment: { date: 'asc' } }, { appointment: { time: 'asc' } }, { createdAt: 'asc' }],
    include: { addenda: { orderBy: { createdAt: 'asc' } }, diagnoses: { orderBy: { createdAt: 'asc' } } }
  });

  return {
    exportedAt: new Date().toISOString(),
    clinic: patient.clinic.name,
    patient: {
      id: patient.id, name: patient.name, cedula: patient.cedula, phone: patient.phone, email: patient.email, createdAt: patient.createdAt,
      ...Object.fromEntries(PROFILE_FIELDS.map((field) => [field, patient[field]]))
    },
    appointments: patient.appointments.map((a) => ({
      id: a.id, date: a.date, time: a.time, status: a.status, notes: a.notes, doctor: a.doctor.name, createdAt: a.createdAt
    })),
    allergies,
    medications,
    backgrounds,
    consultationNotes,
    vitalSigns,
    messagesSent: messages,
    healthDataConsent: { status: consentHistory.status, currentVersion: CURRENT_CONSENT_VERSION, events: consentHistory.history }
  };
}

module.exports = { buildPatientExport };
