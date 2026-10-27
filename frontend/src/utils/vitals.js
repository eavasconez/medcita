// How the vital signs are shown (see backend/src/services/vitals.js). Metric units only.

// The measurements a reading can hold, in the order the form asks them.
export const FIELDS = [
  { name: 'weightKg', label: 'Weight', unit: 'kg', step: '0.01', min: 0.3, max: 500 },
  { name: 'heightCm', label: 'Height', unit: 'cm', step: '0.1', min: 20, max: 260 },
  { name: 'systolic', label: 'Systolic', unit: 'mmHg', step: '1', min: 40, max: 300 },
  { name: 'diastolic', label: 'Diastolic', unit: 'mmHg', step: '1', min: 20, max: 200 },
  { name: 'heartRate', label: 'Heart rate', unit: 'bpm', step: '1', min: 20, max: 300 },
  { name: 'respiratoryRate', label: 'Respiratory rate', unit: 'rpm', step: '1', min: 4, max: 100 },
  { name: 'temperatureC', label: 'Temperature', unit: '°C', step: '0.1', min: 25, max: 45 },
  { name: 'oxygenSaturation', label: 'Oxygen saturation', unit: '%', step: '1', min: 30, max: 100 }
];

export const blankForm = () => Object.fromEntries(FIELDS.map((f) => [f.name, '']));

// The numbers of the form as the API wants them: only what was typed, as numbers.
export const toPayload = (form) =>
  Object.fromEntries(FIELDS.filter((f) => form[f.name] !== '').map((f) => [f.name, Number(form[f.name])]));

// What the history, the latest values and the charts offer. `value` reads it from a reading.
export const METRICS = [
  { key: 'weight', label: 'Weight', unit: 'kg', lines: [{ key: 'weightKg', label: 'Weight', color: '#0ea5e9' }] },
  { key: 'bmi', label: 'BMI', unit: 'kg/m²', lines: [{ key: 'bmi', label: 'BMI', color: '#8b5cf6' }] },
  { key: 'bp', label: 'Blood pressure', unit: 'mmHg', lines: [{ key: 'systolic', label: 'Systolic', color: '#ef4444' }, { key: 'diastolic', label: 'Diastolic', color: '#f59e0b' }] },
  { key: 'hr', label: 'Heart rate', unit: 'bpm', lines: [{ key: 'heartRate', label: 'Heart rate', color: '#ec4899' }] },
  { key: 'rr', label: 'Respiratory rate', unit: 'rpm', lines: [{ key: 'respiratoryRate', label: 'Respiratory rate', color: '#14b8a6' }] },
  { key: 'temp', label: 'Temperature', unit: '°C', lines: [{ key: 'temperatureC', label: 'Temperature', color: '#f97316' }] },
  { key: 'spo2', label: 'Oxygen saturation', unit: '%', lines: [{ key: 'oxygenSaturation', label: 'SpO₂', color: '#10b981' }] }
];

// The readings that count: voided ones stay in the history but out of the charts and the latest values.
export const activeReadings = (readings) => readings.filter((r) => !r.voidedAt);

// The measurements shown as a card and a column, in the order the record lists them. `metric` is the
// chart that follows it (the height has none: it hardly changes). `bp` is the blood pressure, both numbers.
export const MEASURES = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', metric: 'weight' },
  { key: 'heightCm', label: 'Height', unit: 'cm', metric: null },
  { key: 'bmi', label: 'BMI', unit: 'kg/m²', metric: 'bmi' },
  { key: 'bp', label: 'Blood pressure', short: 'BP', unit: 'mmHg', metric: 'bp' },
  { key: 'heartRate', label: 'Heart rate', short: 'HR', unit: 'bpm', metric: 'hr' },
  { key: 'respiratoryRate', label: 'Respiratory rate', short: 'RR', unit: 'rpm', metric: 'rr' },
  { key: 'temperatureC', label: 'Temperature', short: 'Temp', unit: '°C', metric: 'temp' },
  { key: 'oxygenSaturation', label: 'Oxygen saturation', short: 'SpO₂', unit: '%', metric: 'spo2' }
];

const SCALARS = ['weightKg', 'heightCm', 'bmi', 'heartRate', 'respiratoryRate', 'temperatureC', 'oxygenSaturation'];
const present = (value) => value !== null && value !== undefined;
const round = (n) => Math.round(n * 100) / 100;

// The value of one measurement in a reading as text ("81.2", "124/80"), or null if it was not taken.
export function cellOf(reading, key) {
  if (key === 'bp') return present(reading.systolic) ? `${reading.systolic}/${reading.diastolic}` : null;
  return present(reading[key]) ? String(reading[key]) : null;
}

// How a measurement moved between two readings: { delta: number } or, for the blood pressure,
// { systolic, diastolic }.
const changeBetween = (key, latest, previous) =>
  key === 'bp'
    ? { systolic: round(latest.systolic - previous.systolic), diastolic: round(latest.diastolic - previous.diastolic) }
    : { delta: round(latest.number - previous.number) };

// For every measurement: its newest value and date and, if there is an earlier one, that one and what
// changed since. The earlier one is the previous reading that has the same measurement (a weight may
// be from a month ago and a heart rate from today). Voided readings count for nothing.
export function trends(readings) {
  const seen = {};
  for (const reading of activeReadings(readings)) { // newest first
    for (const key of SCALARS) {
      if (present(reading[key])) (seen[key] ||= []).push({ value: reading[key], number: reading[key], at: reading.measuredAt });
    }
    if (present(reading.systolic)) {
      (seen.bp ||= []).push({ value: `${reading.systolic}/${reading.diastolic}`, systolic: reading.systolic, diastolic: reading.diastolic, at: reading.measuredAt });
    }
  }
  return Object.fromEntries(Object.entries(seen).map(([key, [latest, previous = null]]) => [
    key,
    { latest, previous, change: previous ? changeBetween(key, latest, previous) : null }
  ]));
}

// The newest value of every measurement, each with the day it was taken
export function latestValues(readings) {
  return Object.fromEntries(Object.entries(trends(readings)).map(([key, t]) => [key, { value: t.latest.value, at: t.latest.at }]));
}

// A change as text: "+1.2", "−4", "−4/−2", or "No change"
export function describeChange(change) {
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  if (change.delta !== undefined) return change.delta === 0 ? 'No change' : signed(change.delta);
  return change.systolic === 0 && change.diastolic === 0 ? 'No change' : `${signed(change.systolic)}/${signed(change.diastolic)}`;
}

// Which way a change went: 1, -1 or 0 (the blood pressure goes by its systolic number)
export const directionOf = (change) => Math.sign(change.delta !== undefined ? change.delta : change.systolic);

// A reading as one line of text for the history: "70.5 kg · 170 cm · 120/80 mmHg ..."
export function describeReading(reading) {
  const parts = [];
  if (reading.weightKg !== null) parts.push(`${reading.weightKg} kg`);
  if (reading.heightCm !== null) parts.push(`${reading.heightCm} cm`);
  if (reading.bmi !== null && reading.bmi !== undefined) parts.push(`BMI ${reading.bmi}`);
  if (reading.systolic !== null) parts.push(`${reading.systolic}/${reading.diastolic} mmHg`);
  if (reading.heartRate !== null) parts.push(`${reading.heartRate} bpm`);
  if (reading.respiratoryRate !== null) parts.push(`${reading.respiratoryRate} rpm`);
  if (reading.temperatureC !== null) parts.push(`${reading.temperatureC} °C`);
  if (reading.oxygenSaturation !== null) parts.push(`SpO₂ ${reading.oxygenSaturation}%`);
  return parts.join(' · ');
}

// The points of a chart: oldest first, only the readings that have at least one of its lines.
export function chartPoints(readings, metric) {
  return activeReadings(readings)
    .filter((r) => metric.lines.some((line) => r[line.key] !== null && r[line.key] !== undefined))
    .map((r) => ({ at: new Date(r.measuredAt).getTime(), ...Object.fromEntries(metric.lines.map((line) => [line.key, r[line.key] ?? null])) }))
    .sort((a, b) => a.at - b.at);
}

// The value of an <input type="datetime-local"> for a moment (in the browser's zone)
export const toLocalInput = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
