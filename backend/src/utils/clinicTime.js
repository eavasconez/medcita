const { parseISO } = require('date-fns');

const MS_PER_MINUTE = 60 * 1000;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// 'YYYY-MM-DD' that is a real calendar date.
const isValidDate = (value) => typeof value === 'string' && DATE_REGEX.test(value) && !isNaN(parseISO(value).getTime());

// Appointment date/time are stored as clinic-local strings (no timezone), so
// they are interpreted with a fixed clinic offset instead of the server's
// timezone - Render runs in UTC, which would otherwise shift every reminder
// by 5 hours. Defaults to Ecuador mainland (UTC-5, no DST).
const parsedOffset = parseInt(process.env.CLINIC_UTC_OFFSET_MINUTES, 10);
const CLINIC_UTC_OFFSET_MINUTES = Number.isNaN(parsedOffset) ? -300 : parsedOffset;

// 'YYYY-MM-DD' calendar date of an instant, as seen in the clinic.
const clinicDateString = (instant) =>
  new Date(instant.getTime() + CLINIC_UTC_OFFSET_MINUTES * MS_PER_MINUTE)
    .toISOString()
    .slice(0, 10);

// Real instant of a clinic-local 'YYYY-MM-DD' + 'HH:mm' appointment.
const appointmentInstant = (date, time) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) - CLINIC_UTC_OFFSET_MINUTES * MS_PER_MINUTE
  );
};

module.exports = { DATE_REGEX, isValidDate, clinicDateString, appointmentInstant };
