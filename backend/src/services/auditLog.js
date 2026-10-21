// A written record of what an admin or a secretary does with appointments,
// patients and accounts. Doctors acting on their own data are not recorded.
//
// Every record is written in the same database transaction as the action it
// describes (pass the transaction client as `db`): there is never an action
// without its record, nor a record of something that did not happen.

const STAFF_ROLES = ['admin', 'secretary'];
const AUDIT_ACTIONS = ['create', 'update', 'cancel', 'delete'];
const AUDIT_ENTITIES = ['appointment', 'patient', 'user'];

// The fields worth watching per entity. A `shown` field keeps its before/after
// values; a `hidden` one only says that it changed. Contact data of patients,
// appointment notes (they can hold medical details), emails and passwords are
// never copied into the log.
const FIELDS = {
  appointment: { shown: ['date', 'time', 'status'], hidden: ['notes'] },
  patient: { shown: [], hidden: ['name', 'phone', 'email', 'cedula'] },
  user: { shown: ['name', 'role'], hidden: ['email', 'password'] }
};

const orNull = (value) => (value === undefined ? null : value);
const nothingIfEmpty = (changes) => (Object.keys(changes).length > 0 ? changes : null);

// What changed between two versions of a record: { field: { from, to } } for the
// shown fields and { field: { changed: true } } for the hidden ones. Null when
// none of the watched fields differs.
function diffFields(entity, before, after) {
  const { shown, hidden } = FIELDS[entity];
  const changes = {};
  for (const field of shown) {
    if (before[field] !== after[field]) changes[field] = { from: orNull(before[field]), to: orNull(after[field]) };
  }
  for (const field of hidden) {
    if (before[field] !== after[field]) changes[field] = { changed: true };
  }
  return nothingIfEmpty(changes);
}

// The shown fields of a record that was just created: { field: { to } }.
function describeCreated(entity, record) {
  const changes = {};
  for (const field of FIELDS[entity].shown) changes[field] = { to: orNull(record[field]) };
  return nothingIfEmpty(changes);
}

// The shown fields of a record that is about to disappear: { field: { from } },
// so the entry still says what was removed once the row is gone.
function describeRemoved(entity, record) {
  const changes = {};
  for (const field of FIELDS[entity].shown) changes[field] = { from: orNull(record[field]) };
  return nothingIfEmpty(changes);
}

// Writes one entry, or nothing when the request does not come from an admin or
// a secretary. `req.userName` and `req.clinicId` are set by the auth middleware.
async function recordAudit(db, req, { action, entity, entityId, doctorId = null, changes = null }) {
  if (!STAFF_ROLES.includes(req.userRole)) return null;
  return db.auditLog.create({
    data: {
      actorId: req.doctorId,
      actorName: req.userName,
      actorRole: req.userRole,
      clinicId: req.clinicId,
      action,
      entity,
      entityId,
      doctorId,
      changes: changes ?? undefined
    }
  });
}

// A patient that was found-or-updated by phone (see patientUpsert.js): a creation
// when it did not exist, an update (with the fields that changed) when it did,
// and nothing when the data it was given is what it already had.
async function auditPatientUpsert(db, req, { previous, patient }) {
  if (!previous) {
    return recordAudit(db, req, { action: 'create', entity: 'patient', entityId: patient.id });
  }
  const changes = diffFields('patient', previous, patient);
  if (!changes) return null;
  return recordAudit(db, req, { action: 'update', entity: 'patient', entityId: patient.id, changes });
}

module.exports = {
  STAFF_ROLES,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  diffFields,
  describeCreated,
  describeRemoved,
  recordAudit,
  auditPatientUpsert
};
