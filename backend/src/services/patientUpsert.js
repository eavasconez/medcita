// Find-or-update a patient of a clinic by phone (the same phone in two clinics is
// two patients): what both "new patient" and booking an appointment do. `previous` is the patient as it was before (null when it is
// new), so the caller can tell a creation from an update and audit what changed.
//
// The values are already trimmed; `email` and `cedula` are null when not given.
// On update only email/cedula that were actually submitted are touched, so an
// existing patient rebooking with those fields left blank keeps the values
// already stored instead of having them wiped to null.
async function upsertPatient(db, clinicId, { name, phone, email, cedula }) {
  const clinicPhone = { clinicId_phone: { clinicId, phone } };
  const previous = await db.patient.findUnique({ where: clinicPhone });
  const patient = await db.patient.upsert({
    where: clinicPhone,
    update: {
      name,
      ...(email && { email }),
      ...(cedula && { cedula })
    },
    create: { clinicId, name, phone, email, cedula }
  });
  return { patient, previous };
}

module.exports = { upsertPatient };
