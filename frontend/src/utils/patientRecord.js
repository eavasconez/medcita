// How the patient's record is shown (see backend/src/services/patientRecord.js)
export const SEX_LABEL = { female: 'Female', male: 'Male', other: 'Other' };

// "41 years", "3 years", "5 months" (under two years the months matter), "Newborn"
export function formatAge(age) {
  if (!age) return null;
  if (age.years >= 2) return `${age.years} years`;
  const months = age.years * 12 + age.months;
  if (months === 0) return 'Newborn';
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}

// The fields of the record form, in the order they are asked. Empty strings clear a field.
export const RECORD_FIELDS = [
  'birthDate', 'sex', 'address', 'occupation',
  'emergencyContactName', 'emergencyContactPhone',
  'insuranceProvider', 'insuranceNumber',
  'guardianName', 'guardianCedula', 'guardianPhone', 'guardianRelationship'
];

export const recordForm = (patient) =>
  Object.fromEntries([
    ['name', patient.name],
    ['phone', patient.phone],
    ['email', patient.email || ''],
    ['cedula', patient.cedula || ''],
    ...RECORD_FIELDS.map((field) => [field, patient[field] || ''])
  ]);
