// The attendance report (S9-06): of the appointments of a period, how many came, how many
// missed, how many were cancelled and how many are still waiting, overall, by doctor and by
// type of visit. Counts only: nothing about a patient leaves in the figures except the short
// list of who misses the most, which is shown on screen and never exported.

const { inClinic } = require('./../utils/clinicScope');
const { ensureDefaultType } = require('./appointmentTypes');

const ATTENDED = ['arrived', 'in_progress', 'completed'];
const NOT_CONFIRMED = ['pending_approval', 'scheduled'];
const MAX_RANGE_DAYS = 1096; // three years
const TOP_PATIENTS = 10;

const emptyCounts = () => ({ total: 0, attended: 0, noShow: 0, cancelled: 0, confirmed: 0, notConfirmed: 0 });

const addStatus = (counts, status, n) => {
  counts.total += n;
  if (ATTENDED.includes(status)) counts.attended += n;
  else if (status === 'no_show') counts.noShow += n;
  else if (status === 'cancelled') counts.cancelled += n;
  else if (status === 'confirmed') counts.confirmed += n;
  else if (NOT_CONFIRMED.includes(status)) counts.notConfirmed += n;
};

// Of the visits that were closed (the patient came or missed), the share that missed, in % with
// one decimal; null while none is closed. The same figure as the monthly attendance endpoint.
const noShowRate = ({ attended, noShow }) => {
  const closed = attended + noShow;
  return closed > 0 ? Math.round((noShow / closed) * 1000) / 10 : null;
};

const withRate = (counts) => ({ ...counts, noShowRate: noShowRate(counts) });

// Rows grouped by `key`: [{ key, status, _count }] -> Map(key -> counts)
const tally = (rows, keyOf) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, emptyCounts());
    addStatus(map.get(key), row.status, row._count._all);
  }
  return map;
};

// Biggest first, then by name so the order never jumps between two requests
const bySize = (a, b) => b.total - a.total || a.name.localeCompare(b.name);

/**
 * `from` and `to` are 'YYYY-MM-DD' (both included, clinic-local like Appointment.date);
 * `doctorId` narrows it to one doctor of the clinic. `db` is the Prisma client.
 */
async function attendanceReport(db, req, { from, to, doctorId }) {
  const where = inClinic(req, { date: { gte: from, lte: to }, ...(doctorId && { doctorId }) });
  const defaultType = await ensureDefaultType(db, req.clinicId);

  const [overall, perDoctor, perType, missers] = await Promise.all([
    db.appointment.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.appointment.groupBy({ by: ['doctorId', 'status'], where, _count: { _all: true } }),
    db.appointment.groupBy({ by: ['typeId', 'status'], where, _count: { _all: true } }),
    db.appointment.groupBy({
      by: ['patientId'],
      where: { ...where, status: 'no_show' },
      _count: { _all: true },
      orderBy: [{ _count: { patientId: 'desc' } }, { patientId: 'asc' }],
      take: TOP_PATIENTS
    })
  ]);

  const totals = emptyCounts();
  for (const row of overall) addStatus(totals, row.status, row._count._all);

  const doctorCounts = tally(perDoctor, (row) => row.doctorId);
  // An appointment without a type (booked by a version from before types) counts as the default one
  const typeCounts = tally(perType, (row) => row.typeId ?? defaultType.id);

  const [doctors, types, patients] = await Promise.all([
    db.doctor.findMany({ where: inClinic(req, { id: { in: [...doctorCounts.keys()] } }), select: { id: true, name: true } }),
    db.appointmentType.findMany({ where: inClinic(req, { id: { in: [...typeCounts.keys()] } }), select: { id: true, name: true, color: true, durationMinutes: true } }),
    db.patient.findMany({ where: inClinic(req, { id: { in: missers.map((row) => row.patientId) } }), select: { id: true, name: true } })
  ]);
  const doctorName = new Map(doctors.map((d) => [d.id, d.name]));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const patientName = new Map(patients.map((p) => [p.id, p.name]));

  return {
    from,
    to,
    doctorId: doctorId || null,
    totals: withRate(totals),
    byDoctor: [...doctorCounts]
      .map(([id, counts]) => ({ doctorId: id, name: doctorName.get(id) || '', ...withRate(counts) }))
      .sort(bySize),
    byType: [...typeCounts]
      .map(([id, counts]) => {
        const type = typeById.get(id);
        return { typeId: id, name: type?.name || '', color: type?.color || null, durationMinutes: type?.durationMinutes ?? null, ...withRate(counts) };
      })
      .sort(bySize),
    noShowByPatient: missers.map((row) => ({ patientId: row.patientId, name: patientName.get(row.patientId) || '', noShows: row._count._all }))
  };
}

// --- CSV ---

// A cell that starts with = + - @ (or a tab or return) would be run as a formula by a
// spreadsheet; a doctor's or a type's name is typed by people, so it is defused with a quote.
const FORMULA_START = /^[=+\-@\t\r]/;
const csvCell = (value) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const CSV_HEADER = ['section', 'name', 'total', 'attended', 'no_show', 'cancelled', 'confirmed', 'not_confirmed', 'no_show_rate_percent'];

// The report as rows of a spreadsheet: one for the whole period, then one per doctor and per
// type. Counts only, no patient data. Starts with a byte order mark so Excel reads the accents.
function attendanceCsv(report) {
  const line = (section, name, counts) =>
    [section, name, counts.total, counts.attended, counts.noShow, counts.cancelled, counts.confirmed, counts.notConfirmed, counts.noShowRate].map(csvCell).join(',');
  const lines = [
    CSV_HEADER.join(','),
    line('total', `${report.from} to ${report.to}`, report.totals),
    ...report.byDoctor.map((row) => line('doctor', row.name, row)),
    ...report.byType.map((row) => line('type', row.name, row))
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = { MAX_RANGE_DAYS, attendanceReport, attendanceCsv, noShowRate, csvCell };
