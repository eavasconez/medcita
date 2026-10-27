const prisma = require('../config/prisma');
const { CURRENT_CONSENT_VERSION } = require('../legal/healthDataConsent');
const { recordAudit } = require('./auditLog');

// Where a patient stands, from their latest consent event (events are never edited):
//   none      nothing recorded yet
//   granted   they agreed; `upToDate` says whether it was to the text in force today
//   withdrawn they took it back
const publicEvent = (event) => ({
  id: event.id,
  createdAt: event.createdAt,
  granted: event.granted,
  documentVersion: event.documentVersion,
  method: event.method,
  recordedBy: { name: event.recordedByName, role: event.recordedByRole }
});

function summarize(events) {
  // newest first
  const sorted = [...events].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  const latest = sorted[0];
  if (!latest) return { status: 'none', upToDate: false, current: null };
  return {
    status: latest.granted ? 'granted' : 'withdrawn',
    upToDate: latest.granted && latest.documentVersion === CURRENT_CONSENT_VERSION,
    current: publicEvent(latest)
  };
}

// The standing of each of these patients, in one query: { patientId: { status, upToDate } }
async function statusByPatient(clinicId, patientIds) {
  if (patientIds.length === 0) return {};
  const latest = await prisma.patientConsent.findMany({
    where: { clinicId, patientId: { in: patientIds } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    distinct: ['patientId']
  });
  const result = {};
  for (const id of patientIds) result[id] = { status: 'none', upToDate: false };
  for (const event of latest) {
    result[event.patientId] = {
      status: event.granted ? 'granted' : 'withdrawn',
      upToDate: event.granted && event.documentVersion === CURRENT_CONSENT_VERSION,
      recordedAt: event.createdAt
    };
  }
  return result;
}

// The ids to filter the patient list by a standing (none, granted, outdated or withdrawn):
// { ids, negate }. `none` is everyone WITHOUT an event, so it is the ids with one, negated. One
// query: the latest event of each patient of the clinic, which is also what statusByPatient reads.
async function standingFilter(clinicId, standing) {
  const latest = await prisma.$queryRaw`
    SELECT DISTINCT ON ("patientId") "patientId", granted, "documentVersion"
    FROM "PatientConsent"
    WHERE "clinicId" = ${clinicId}
    ORDER BY "patientId", "createdAt" DESC, id DESC`;
  if (standing === 'none') return { ids: latest.map((e) => e.patientId), negate: true };
  const matches = {
    granted: (e) => e.granted && e.documentVersion === CURRENT_CONSENT_VERSION,
    outdated: (e) => e.granted && e.documentVersion !== CURRENT_CONSENT_VERSION,
    withdrawn: (e) => !e.granted
  }[standing];
  return { ids: latest.filter(matches).map((e) => e.patientId), negate: false };
}

async function history(clinicId, patientId, db = prisma) {
  const events = await db.patientConsent.findMany({
    where: { clinicId, patientId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  });
  return { ...summarize(events), history: events.map(publicEvent) };
}

// Records one event, with who did it, and (for staff) an entry in the audit log, in the
// same transaction.
async function recordConsent(req, patientId, { granted, method }) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.patientConsent.create({
      data: {
        clinicId: req.clinicId,
        patientId,
        granted,
        documentVersion: CURRENT_CONSENT_VERSION,
        method,
        recordedById: req.doctorId,
        recordedByName: req.userName,
        recordedByRole: req.userRole
      }
    });
    await recordAudit(tx, req, {
      action: 'create',
      entity: 'consent',
      entityId: patientId,
      changes: { granted: { to: granted }, documentVersion: { to: event.documentVersion }, method: { to: method } }
    });
    return event;
  });
}

module.exports = { summarize, statusByPatient, standingFilter, history, recordConsent, publicEvent };
