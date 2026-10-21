const { clinicDateTime, DEFAULT_TIMEZONE } = require('../../src/utils/clinicTime');

// Clinic-local date/time helpers. Appointments store `date` ("YYYY-MM-DD") and
// `time` ("HH:mm") as clinic-local text; the default clinic is Ecuador mainland (UTC-5).
const HOUR = 3600 * 1000;

// Clinic-local { date, time } for the instant `hours` from now, in the clinic's `timezone`.
function clinicParts(hours = 0, from = Date.now(), timezone = DEFAULT_TIMEZONE) {
  const instant = Math.floor((from + hours * HOUR) / 60000) * 60000; // whole minutes
  return clinicDateTime(new Date(instant), timezone);
}

// Fixed far-future dates (no "time already passed" logic applies to them).
// 2030-01-14 is a Monday, 2030-01-15 a Tuesday, 2030-01-19 a Saturday.
const MONDAY = '2030-01-14';
const TUESDAY = '2030-01-15';
const SATURDAY = '2030-01-19';

module.exports = { clinicParts, MONDAY, TUESDAY, SATURDAY, HOUR };
