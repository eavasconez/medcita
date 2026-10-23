const { isValidDate } = require('../utils/clinicTime');

// The patient's record (S10-02): who the patient is beyond a name and a phone. These are
// demographic and administrative data, not clinical ones, so the front desk fills them in
// too; the clinical record (S10-03 onwards) has its own rules (middleware/clinicalAccess.js).

const SEXES = ['female', 'male', 'other'];
const ADULT_AGE = 18;
const OLDEST_BIRTH_DATE = '1900-01-01';

const TEXT_FIELDS = {
  address: 300,
  occupation: 120,
  emergencyContactName: 120,
  insuranceProvider: 120,
  insuranceNumber: 60,
  guardianName: 120,
  guardianCedula: 20,
  guardianRelationship: 60
};
const PHONE_FIELDS = ['emergencyContactPhone', 'guardianPhone'];
const PHONE_REGEX = /^[+\d][\d\s()-]{5,24}$/;

const PROFILE_FIELDS = ['birthDate', 'sex', ...Object.keys(TEXT_FIELDS), ...PHONE_FIELDS];

const label = (field) => field.replace(/([A-Z])/g, ' $1').toLowerCase();

// The record fields of a request body, ready to store. Only what was sent is returned, so
// an update that leaves a field out keeps it; an empty string clears it (null). `today` is
// the clinic's date ('YYYY-MM-DD'): nobody is born tomorrow.
// -> { data } or { error }
function parseProfile(body, today) {
  const data = {};
  for (const field of PROFILE_FIELDS) {
    if (body[field] === undefined) continue;
    const raw = body[field];
    if (raw === null || (typeof raw === 'string' && !raw.trim())) {
      data[field] = null;
      continue;
    }
    if (typeof raw !== 'string') return { error: `${label(field)} must be text` };
    const value = raw.trim();

    if (field === 'birthDate') {
      if (!isValidDate(value)) return { error: 'birthDate must be a real date (YYYY-MM-DD)' };
      if (value > today) return { error: 'birthDate cannot be in the future' };
      if (value < OLDEST_BIRTH_DATE) return { error: `birthDate cannot be before ${OLDEST_BIRTH_DATE}` };
    } else if (field === 'sex') {
      if (!SEXES.includes(value)) return { error: `sex must be one of: ${SEXES.join(', ')}` };
    } else if (PHONE_FIELDS.includes(field)) {
      if (!PHONE_REGEX.test(value)) return { error: `${label(field)} is not a valid phone number` };
    } else if (value.length > TEXT_FIELDS[field]) {
      return { error: `${label(field)} must be at most ${TEXT_FIELDS[field]} characters` };
    }
    data[field] = value;
  }
  return { data };
}

// Completed years and months between a birth date and `today`, both 'YYYY-MM-DD'.
// Null without a birth date. The month count is what tells a 5-month-old from a newborn.
function ageOn(birthDate, today) {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 0) months = 0;
  return { years: Math.floor(months / 12), months: months % 12 };
}

const isMinor = (birthDate, today) => {
  const age = ageOn(birthDate, today);
  return age !== null && age.years < ADULT_AGE;
};

// What the record screens need on top of the stored fields.
const withDerived = (patient, today) => ({
  ...patient,
  age: ageOn(patient.birthDate, today),
  isMinor: isMinor(patient.birthDate, today),
  // A minor with nobody registered to answer for them: the front desk is warned
  missingGuardian: isMinor(patient.birthDate, today) && !patient.guardianName
});

module.exports = { SEXES, ADULT_AGE, PROFILE_FIELDS, parseProfile, ageOn, isMinor, withDerived };
