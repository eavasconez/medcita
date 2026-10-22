// Find-or-update a patient of a clinic by phone (the same phone in two clinics is
// two patients): what both "new patient" and booking an appointment do. `previous` is the patient as it was before (null when it is
// new), so the caller can tell a creation from an update and audit what changed.
//
// `profile` holds the record fields of the request (services/patientRecord.js), only the
// ones that were sent.
//
// The values are already trimmed; `email` and `cedula` are null when not given.
// On update only email/cedula that were actually submitted are touched, so an
// existing patient rebooking with those fields left blank keeps the values
// already stored instead of having them wiped to null.
async function upsertPatient(db, clinicId, { name, phone, email, cedula, profile = {} }) {
  const clinicPhone = { clinicId_phone: { clinicId, phone } };
  const previous = await db.patient.findUnique({ where: clinicPhone });
  const patient = await db.patient.upsert({
    where: clinicPhone,
    update: {
      name,
      ...(email && { email }),
      ...(cedula && { cedula }),
      // The record fields that were sent (S10-02); the ones left out are not touched
      ...profile
    },
    create: { clinicId, name, phone, email, cedula, ...profile }
  });
  return { patient, previous };
}

module.exports = { upsertPatient };
