const { parseISO } = require('date-fns');

const MS_PER_MINUTE = 60 * 1000;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// 'YYYY-MM-DD' that is a real calendar date.
const isValidDate = (value) => typeof value === 'string' && DATE_REGEX.test(value) && !isNaN(parseISO(value).getTime());

// Appointment date/time are stored as clinic-local strings (no timezone), so
// they are interpreted in the IANA zone of the clinic (Clinic.timezone) instead
// of the server's - Render runs in UTC, which would otherwise shift every reminder
// by 5 hours. Intl knows each zone's daylight saving rules, so a clinic outside
// Ecuador works too.
const DEFAULT_TIMEZONE = 'America/Guayaquil';

const SUPPORTED_TIMEZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

// Intl also accepts things that are not zone names (such as "+05:00"); only real
// IANA names are stored.
const isValidTimezone = (value) => typeof value === 'string' && SUPPORTED_TIMEZONES.has(value);

// Building a formatter is slow and the same few zones are asked for all the time
const formatters = new Map();
const formatterFor = (timezone) => {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
};

// Wall-clock numbers of an instant in a zone
const wallParts = (instant, timezone) => {
  const parts = {};
  for (const { type, value } of formatterFor(timezone).formatToParts(instant)) parts[type] = value;
  return parts;
};

// Minutes the zone is ahead of UTC at that instant (-300 for Ecuador mainland).
const offsetMinutes = (instant, timezone) => {
  const p = wallParts(instant, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / MS_PER_MINUTE);
};

// { date: 'YYYY-MM-DD', time: 'HH:mm' } of an instant, as seen in the clinic.
const clinicDateTime = (instant, timezone = DEFAULT_TIMEZONE) => {
  const p = wallParts(instant, timezone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

// 'YYYY-MM-DD' calendar date of an instant, as seen in the clinic.
const clinicDateString = (instant, timezone = DEFAULT_TIMEZONE) => clinicDateTime(instant, timezone).date;

// Real instant of a clinic-local 'YYYY-MM-DD' + 'HH:mm' appointment. The zone's
// offset depends on the date (daylight saving), so it is looked up twice: once
// for a first guess and once at the guessed instant.
const appointmentInstant = (date, time, timezone = DEFAULT_TIMEZONE) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const guess = new Date(wall - offsetMinutes(new Date(wall), timezone) * MS_PER_MINUTE);
  return new Date(wall - offsetMinutes(guess, timezone) * MS_PER_MINUTE);
};

module.exports = {
  DATE_REGEX,
  DEFAULT_TIMEZONE,
  isValidDate,
  isValidTimezone,
  clinicDateTime,
  clinicDateString,
  appointmentInstant
};
