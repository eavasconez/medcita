const { appointmentInstant } = require('../utils/clinicTime');
const { withBmi } = require('./vitals');

// The story of a patient in one list, newest first (S10-07): their visits, the consultation notes
// with their diagnoses, the addenda, the vital signs and every event of their consent. Clinical
// data: the route that uses this sits behind middleware/clinicalAccess.js.
//
// Each event is { type, at, id, ...what that type needs }. The text of a note is NOT in the
// timeline (it is long and has its own screen); the vital signs are, since they are numbers.

const TYPES = ['appointment', 'note', 'addendum', 'vitals', 'consent'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// A patient's history is read whole and merged here; this keeps a runaway record from being
// loaded in full on every call
const MAX_PER_SOURCE = 2000;

const byNewest = (a, b) => b.at - a.at || (a.id < b.id ? 1 : -1);

// All the events of the patient, newest first, as { at: Date, ... } (not yet cut to a page).
async function collectEvents(db, req, patientId, types) {
  const where = { patientId, clinicId: req.clinicId };
  const wanted = (type) => types.includes(type);
  const events = [];

  if (wanted('appointment')) {
    const rows = await db.appointment.findMany({
      where,
      take: MAX_PER_SOURCE,
      include: { doctor: { select: { name: true } }, type: { select: { name: true } }, consultationNote: { select: { id: true, status: true } } }
    });
    for (const a of rows) {
      events.push({
        type: 'appointment',
        id: a.id,
        at: appointmentInstant(a.date, a.time, req.clinicTimezone),
        date: a.date,
        time: a.time,
        status: a.status,
        durationMinutes: a.durationMinutes,
        doctor: a.doctor.name,
        appointmentType: a.type?.name ?? null,
        noteId: a.consultationNote?.id ?? null
      });
    }
  }

  if (wanted('note') || wanted('addendum')) {
    const notes = await db.consultationNote.findMany({
      where,
      take: MAX_PER_SOURCE,
      include: {
        appointment: { select: { date: true, time: true } },
        diagnoses: { orderBy: { createdAt: 'asc' } },
        addenda: { orderBy: { createdAt: 'asc' } }
      }
    });
    for (const n of notes) {
      if (wanted('note')) {
        const diagnoses = [...n.diagnoses].sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary'));
        events.push({
          type: 'note',
          id: n.id,
          // a closed note sits at the moment it was closed, a draft at the last time it was touched
          at: n.status === 'closed' ? n.closedAt : n.updatedAt,
          appointmentId: n.appointmentId,
          visit: `${n.appointment.date} ${n.appointment.time}`,
          status: n.status,
          authorName: n.authorName,
          closedByName: n.closedByName,
          diagnoses: diagnoses.map((d) => ({ code: d.code, name: d.name, kind: d.kind, certainty: d.certainty })),
          addendaCount: n.addenda.length
        });
      }
      if (wanted('addendum')) {
        for (const a of n.addenda) {
          events.push({ type: 'addendum', id: a.id, at: a.createdAt, noteId: n.id, appointmentId: n.appointmentId, authorName: a.authorName, text: a.text });
        }
      }
    }
  }

  if (wanted('vitals')) {
    const rows = await db.patientVitals.findMany({ where, orderBy: { measuredAt: 'desc' }, take: MAX_PER_SOURCE });
    for (const v of rows) {
      events.push({
        type: 'vitals',
        id: v.id,
        at: v.measuredAt,
        appointmentId: v.appointmentId,
        recordedByName: v.recordedByName,
        voided: Boolean(v.voidedAt),
        reading: withBmi({
          weightKg: v.weightKg, heightCm: v.heightCm, systolic: v.systolic, diastolic: v.diastolic, heartRate: v.heartRate,
          respiratoryRate: v.respiratoryRate, temperatureC: v.temperatureC, oxygenSaturation: v.oxygenSaturation
        })
      });
    }
  }

  if (wanted('consent')) {
    const rows = await db.patientConsent.findMany({ where, orderBy: { createdAt: 'desc' }, take: MAX_PER_SOURCE });
    for (const c of rows) {
      events.push({ type: 'consent', id: c.id, at: c.createdAt, granted: c.granted, documentVersion: c.documentVersion, method: c.method, recordedByName: c.recordedByName });
    }
  }

  return events.sort(byNewest);
}

// One page of the timeline. `before` (an ISO date) takes the events strictly older than it, so
// the next page starts where this one ended: a page never splits events of the same instant.
// -> { events, nextBefore } (`nextBefore` is null on the last page)
async function buildTimeline(db, req, patientId, { limit = DEFAULT_LIMIT, before = null, types = TYPES } = {}) {
  const all = await collectEvents(db, req, patientId, types);
  const older = before ? all.filter((event) => event.at < before) : all;

  let page = older.slice(0, limit);
  if (older.length > limit) {
    const edge = page[page.length - 1].at.getTime();
    page = older.slice(0, limit);
    for (let i = limit; i < older.length && older[i].at.getTime() === edge; i += 1) page.push(older[i]);
  }
  const hasMore = older.length > page.length;
  return {
    events: page.map((event) => ({ ...event, at: event.at.toISOString() })),
    nextBefore: hasMore ? page[page.length - 1].at : null
  };
}

module.exports = { TYPES, DEFAULT_LIMIT, MAX_LIMIT, buildTimeline };
