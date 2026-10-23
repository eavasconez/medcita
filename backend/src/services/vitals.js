// The vital signs of a patient (S10-06): what a reading may hold and how it is checked. Clinical
// data: the routes that use this sit behind middleware/clinicalAccess.js.

// Metric units. The limits only reject what cannot be a measurement of a person (a typo such as
// a weight of 700 kg or a pulse of 7); they say nothing about what is normal.
const MEASURES = {
  weightKg: { label: 'weightKg', min: 0.3, max: 500, decimals: 2 },
  heightCm: { label: 'heightCm', min: 20, max: 260, decimals: 1 },
  systolic: { label: 'systolic', min: 40, max: 300, integer: true },
  diastolic: { label: 'diastolic', min: 20, max: 200, integer: true },
  heartRate: { label: 'heartRate', min: 20, max: 300, integer: true },
  respiratoryRate: { label: 'respiratoryRate', min: 4, max: 100, integer: true },
  temperatureC: { label: 'temperatureC', min: 25, max: 45, decimals: 1 },
  oxygenSaturation: { label: 'oxygenSaturation', min: 30, max: 100, integer: true }
};

const EARLIEST_MEASURED_AT = new Date('2000-01-01T00:00:00Z');
// A clock a few minutes ahead is not a reading from the future
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_VOID_REASON_LENGTH = 200;

const isBlank = (value) => value === undefined || value === null || value === '';

const decimalsOf = (value) => {
  const text = String(value);
  return text.includes('.') ? text.split('.')[1].length : 0;
};

// The measurements of a request body, ready to store: `null` for what was not taken. At least one
// must be there; blood pressure comes as both numbers or none, the first above the second.
// -> { data } or { error }
function parseVitals(body, now = new Date()) {
  const data = {};
  for (const [field, rule] of Object.entries(MEASURES)) {
    const value = body?.[field];
    if (isBlank(value)) {
      data[field] = null;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `${field} must be a number` };
    if (rule.integer && !Number.isInteger(value)) return { error: `${field} must be a whole number` };
    if (rule.decimals !== undefined && decimalsOf(value) > rule.decimals) {
      return { error: `${field} can have at most ${rule.decimals} decimal${rule.decimals === 1 ? '' : 's'}` };
    }
    if (value < rule.min || value > rule.max) return { error: `${field} must be between ${rule.min} and ${rule.max}` };
    data[field] = value;
  }

  if ((data.systolic === null) !== (data.diastolic === null)) {
    return { error: 'Blood pressure needs both numbers: systolic and diastolic' };
  }
  if (data.systolic !== null && data.systolic <= data.diastolic) {
    return { error: 'systolic must be higher than diastolic' };
  }
  if (Object.values(data).every((value) => value === null)) {
    return { error: 'Record at least one measurement' };
  }

  let measuredAt = now;
  if (!isBlank(body?.measuredAt)) {
    measuredAt = typeof body.measuredAt === 'string' ? new Date(body.measuredAt) : new Date(NaN);
    if (Number.isNaN(measuredAt.getTime())) return { error: 'measuredAt must be a date and time (ISO 8601)' };
    if (measuredAt.getTime() > now.getTime() + CLOCK_TOLERANCE_MS) return { error: 'measuredAt cannot be in the future' };
    if (measuredAt < EARLIEST_MEASURED_AT) return { error: 'measuredAt is too far in the past' };
  }
  data.measuredAt = measuredAt;
  return { data };
}

// Body mass index (kg/m²) with one decimal; null unless the reading has both weight and height.
function bmiOf({ weightKg, heightCm }) {
  if (!weightKg || !heightCm) return null;
  const meters = heightCm / 100;
  return Math.round((weightKg / (meters * meters)) * 10) / 10;
}

const withBmi = (reading) => ({ ...reading, bmi: bmiOf(reading) });

module.exports = { MEASURES, MAX_VOID_REASON_LENGTH, parseVitals, bmiOf, withBmi };
