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

// The newest value of every measurement, each with the day it was taken (a weight may be from a
// month ago and a heart rate from today).
export function latestValues(readings) {
  const latest = {};
  for (const reading of activeReadings(readings)) { // newest first
    for (const key of ['weightKg', 'heightCm', 'bmi', 'heartRate', 'respiratoryRate', 'temperatureC', 'oxygenSaturation']) {
      if (latest[key] === undefined && reading[key] !== null && reading[key] !== undefined) latest[key] = { value: reading[key], at: reading.measuredAt };
    }
    if (latest.bp === undefined && reading.systolic !== null) latest.bp = { value: `${reading.systolic}/${reading.diastolic}`, at: reading.measuredAt };
  }
  return latest;
}

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
