// Find-or-update a patient by phone: what both "new patient" and booking an
// appointment do. `previous` is the patient as it was before (null when it is
// new), so the caller can tell a creation from an update and audit what changed.
//
// The values are already trimmed; `email` and `cedula` are null when not given.
// On update only email/cedula that were actually submitted are touched, so an
// existing patient rebooking with those fields left blank keeps the values
// already stored instead of having them wiped to null.
async function upsertPatient(db, { name, phone, email, cedula }) {
  const previous = await db.patient.findUnique({ where: { phone } });
  const patient = await db.patient.upsert({
    where: { phone },
    update: {
      name,
      ...(email && { email }),
      ...(cedula && { cedula })
    },
    create: { name, phone, email, cedula }
  });
  return { patient, previous };
}

module.exports = { upsertPatient };
