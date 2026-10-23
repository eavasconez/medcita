// The patient's allergies, regular medication and history (S10-03). Clinical data: the routes
// that use this sit behind middleware/clinicalAccess.js.
//
// The three lists share their shape (a few validated fields, an `active` flag for the first
// two), so one table of rules describes them and one router (routes/clinicalBackground.js)
// serves them.

const SEVERITIES = ['mild', 'moderate', 'severe'];
const BACKGROUND_CATEGORIES = ['personal', 'family', 'surgical', 'habit'];
// A patient with more than this many lines of one kind is a mistake or an abuse
const MAX_ITEMS_PER_PATIENT = 100;

// Each field: required (on create), max length of the text, or the list of values allowed.
const KINDS = {
  allergies: {
    model: 'patientAllergy',
    entity: 'patient_allergy',
    fields: {
      substance: { required: true, max: 120 },
      reaction: { max: 200 },
      severity: { values: SEVERITIES },
      active: { boolean: true }
    }
  },
  medications: {
    model: 'patientMedication',
    entity: 'patient_medication',
    fields: {
      name: { required: true, max: 120 },
      dose: { max: 60 },
      frequency: { max: 60 },
      active: { boolean: true }
    }
  },
  backgrounds: {
    model: 'patientBackground',
    entity: 'patient_background',
    fields: {
      category: { required: true, values: BACKGROUND_CATEGORIES },
      description: { required: true, max: 500 },
      noted: { max: 60 }
    }
  }
};

// The fields of a request body for `kind`, ready to store. Only what was sent is returned
// (an update keeps the rest); an empty string clears an optional field. On create the
// required ones must be there. -> { data } or { error }
function parseItem(kind, body, { creating }) {
  const data = {};
  for (const [field, rule] of Object.entries(KINDS[kind].fields)) {
    const raw = body?.[field];
    if (raw === undefined) {
      if (creating && rule.required) return { error: `${field} is required` };
      continue;
    }
    if (rule.boolean) {
      if (typeof raw !== 'boolean') return { error: `${field} must be true or false` };
      data[field] = raw;
      continue;
    }
    if (raw === null || (typeof raw === 'string' && !raw.trim())) {
      if (rule.required) return { error: `${field} is required` };
      data[field] = null;
      continue;
    }
    if (typeof raw !== 'string') return { error: `${field} must be text` };
    const value = raw.trim();
    if (rule.values && !rule.values.includes(value)) return { error: `${field} must be one of: ${rule.values.join(', ')}` };
    if (rule.max && value.length > rule.max) return { error: `${field} must be at most ${rule.max} characters` };
    data[field] = value;
  }
  return { data };
}

const SEVERITY_RANK = { severe: 0, moderate: 1, mild: 2 };

// Active first; among allergies the worst first, then the newest.
const byImportance = (a, b) =>
  Number(b.active ?? true) - Number(a.active ?? true) ||
  (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
  b.createdAt - a.createdAt;

module.exports = { KINDS, SEVERITIES, BACKGROUND_CATEGORIES, MAX_ITEMS_PER_PATIENT, parseItem, byImportance };
