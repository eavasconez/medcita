// A written record of what an admin or a secretary does with appointments,
// patients and accounts, and of how people sign in: every successful and failed
// sign-in of an existing account, and every password change. Doctors acting on
// their own data are not recorded. What a patient does by tapping a button of the
// WhatsApp reminder (confirm or cancel the visit) is recorded as well, as the patient. Each entry also keeps where the request came
// from (IP and User-Agent) and the clinic of whoever acted.
//
// Every record is written in the same database transaction as the action it
// describes (pass the transaction client as `db`): there is never an action
// without its record, nor a record of something that did not happen.

const STAFF_ROLES = ['admin', 'secretary'];
// `read` is for looking at something that must stay traceable: the export of a patient's
// data and the clinical record (recordClinicalRead).
const AUDIT_ACTIONS = [
  'create', 'update', 'cancel', 'delete',
  'login', 'login_failed', 'password_change', 'password_reset',
  'read'
];
const AUDIT_ENTITIES = ['appointment', 'patient', 'user', 'invitation', 'consent', 'patient_export', 'appointment_type', 'schedule_block', 'reminder_settings', 'clinical_record'];

// The fields worth watching per entity. A `shown` field keeps its before/after
// values; a `hidden` one only says that it changed. Contact data of patients,
// appointment notes (they can hold medical details), emails and passwords are
// never copied into the log.
const FIELDS = {
  appointment: { shown: ['date', 'time', 'status'], hidden: ['notes', 'typeId'] },
  patient: {
    shown: [],
    // Personal and family data: only that it changed, never its value
    hidden: [
      'name', 'phone', 'email', 'cedula',
      'birthDate', 'sex', 'address', 'occupation', 'emergencyContactName', 'emergencyContactPhone',
      'insuranceProvider', 'insuranceNumber', 'guardianName', 'guardianCedula', 'guardianPhone', 'guardianRelationship'
    ]
  },
  user: { shown: ['name', 'role'], hidden: ['email', 'password'] },
  // An invitation to join the clinic; the account itself is created by its owner later
  invitation: { shown: ['role'], hidden: ['name', 'email'] },
  // A kind of visit the clinic offers (admins manage them)
  appointment_type: { shown: ['name', 'durationMinutes', 'color', 'active'], hidden: [] },
  // Days nobody attends; the reason is free text that can say too much, so it is not kept
  schedule_block: { shown: ['startDate', 'endDate'], hidden: [] },
  // How the clinic reminds its patients; the address and the indications are free text
  reminder_settings: { shown: ['reminderEnabled', 'reminderHours', 'secondReminderHours', 'reminderWhatsapp', 'reminderEmail'], hidden: ['address', 'reminderIndications'] }
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

const MAX_USER_AGENT_LENGTH = 255;

// Node reports an IPv4 client on a dual-stack socket as "::ffff:203.0.113.7"; keep the
// plain address people recognise.
const plainIp = (ip) => (ip ? ip.replace(/^::ffff:/i, '') : null);

// Where a request came from. `req.ip` is the real client when TRUST_PROXY is right.
const requestOrigin = (req) => ({
  ip: plainIp(req?.ip),
  userAgent: (req?.get?.('user-agent') || '').slice(0, MAX_USER_AGENT_LENGTH) || null
});

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
      changes: changes ?? undefined,
      ...requestOrigin(req)
    }
  });
}

// A patient confirmed or cancelled their own visit from the WhatsApp reminder (S9-02). The
// patient is not a user, so the entry is written as the patient: their id (never their name or
// number, the entry is shown to the clinic's admins) and the role 'patient'. `origin` is where
// the request came from (requestOrigin of the webhook call: Meta's server).
function recordPatientAction(db, { clinicId, patientId, action, entityId, doctorId = null, changes = null, origin = {} }) {
  return db.auditLog.create({
    data: {
      actorId: patientId,
      actorName: 'Patient (WhatsApp)',
      actorRole: 'patient',
      clinicId,
      action,
      entity: 'appointment',
      entityId,
      doctorId,
      changes: changes ?? undefined,
      ip: origin.ip ?? null,
      userAgent: origin.userAgent ?? null
    }
  });
}

// An entry about the account itself, for the moments when the person is not (yet)
// signed in: a sign-in, a failed one, a password reset. `account` is the Doctor row
// (id, name, role, clinicId). Any role is recorded, not only staff, and nothing the
// person typed is kept: not the email, not the password.
function recordAccountEvent(db, req, account, action) {
  return db.auditLog.create({
    data: {
      actorId: account.id,
      actorName: account.name,
      actorRole: account.role,
      clinicId: account.clinicId,
      action,
      entity: 'user',
      entityId: account.id,
      ...requestOrigin(req)
    }
  });
}

// Someone looked at a record that must stay traceable (today: the export of a patient's
// data; later the clinical history). Recorded for every role, since reading is the point.
function recordRead(db, req, { entity, entityId, doctorId = null, changes = undefined }) {
  return db.auditLog.create({
    data: {
      actorId: req.doctorId,
      actorName: req.userName,
      actorRole: req.userRole,
      clinicId: req.clinicId,
      action: 'read',
      entity,
      entityId,
      doctorId,
      ...(changes && { changes }),
      ...requestOrigin(req)
    }
  });
}

// Someone looked at part of a patient's clinical record (S10-01). One entry per patient,
// with the part that was opened ("notes", "allergies"...) and never its content.
// `db` is the transaction when the read happens inside one.
function recordClinicalRead(db, req, { patientId, section }) {
  return recordRead(db, req, {
    entity: 'clinical_record',
    entityId: patientId,
    changes: { section: { to: section } }
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
  requestOrigin,
  recordAudit,
  recordPatientAction,
  recordAccountEvent,
  recordRead,
  recordClinicalRead,
  auditPatientUpsert
};
