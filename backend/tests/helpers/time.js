// Clinic-local date/time helpers. Appointments store `date` ("YYYY-MM-DD") and
// `time` ("HH:mm") as clinic-local text; the default clinic offset is UTC-5.
const CLINIC_OFFSET_MINUTES = -300;
const HOUR = 3600 * 1000;

// Clinic-local { date, time } for the instant `hours` from now.
function clinicParts(hours = 0, from = Date.now()) {
  const instant = Math.floor((from + hours * HOUR) / 60000) * 60000; // whole minutes
  const iso = new Date(instant + CLINIC_OFFSET_MINUTES * 60000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

// Fixed far-future dates (no "time already passed" logic applies to them).
// 2030-01-14 is a Monday, 2030-01-15 a Tuesday, 2030-01-19 a Saturday.
const MONDAY = '2030-01-14';
const TUESDAY = '2030-01-15';
const SATURDAY = '2030-01-19';

module.exports = { clinicParts, MONDAY, TUESDAY, SATURDAY, HOUR };
