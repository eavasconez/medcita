// Everything in MedCita belongs to a clinic, and a signed-in user only ever works
// inside their own. `req.clinicId` is set by the auth middleware from the user's
// account (never from the request), and every query on clinic data goes through
// one of these so a record of another clinic simply does not exist for the caller.

// A `where` restricted to the caller's clinic: inClinic(req, { id })
const inClinic = (req, where = {}) => ({ ...where, clinicId: req.clinicId });

// The doctor with this id when they belong to the caller's clinic, otherwise null
// (also when there is no such doctor: the two cases look the same from outside).
// `db` is the Prisma client or a transaction client.
const findDoctorInClinic = (db, req, doctorId) =>
  typeof doctorId === 'string' && doctorId
    ? db.doctor.findFirst({ where: inClinic(req, { id: doctorId }), select: { id: true } })
    : null;

module.exports = { inClinic, findDoctorInClinic };
