// The SOAP note of an appointment (S10-04). Clinical data: the routes that use this sit behind
// middleware/clinicalAccess.js.

const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'];
const MAX_SECTION_LENGTH = 10000;
const MAX_ADDENDUM_LENGTH = 5000;

// Where a note starts. The headings are what the doctor writes under, in the doctor's
// language; the name of the template is what the screen shows. `blank` starts empty.
const TEMPLATES = {
  general: {
    label: 'General medicine',
    subjective: 'Motivo de consulta:\n\nEnfermedad actual:\n',
    objective: 'Examen físico:\n',
    assessment: 'Impresión diagnóstica:\n',
    plan: 'Tratamiento:\n\nExámenes:\n\nControl:\n'
  },
  pediatrics: {
    label: 'Pediatrics',
    subjective: 'Motivo de consulta:\n\nEnfermedad actual:\n\nAlimentación:\n\nVacunas al día:\n\nDesarrollo:\n',
    objective: 'Peso:\nTalla:\nPerímetro cefálico:\n\nExamen físico:\n',
    assessment: 'Impresión diagnóstica:\n',
    plan: 'Tratamiento:\n\nSignos de alarma explicados:\n\nControl:\n'
  },
  blank: { label: 'Blank', subjective: '', objective: '', assessment: '', plan: '' }
};

const templateList = () => Object.entries(TEMPLATES).map(([id, { label }]) => ({ id, label }));

// The sections of a template, ready to store. -> null for an unknown template
function sectionsOf(templateId) {
  const template = TEMPLATES[templateId];
  if (!template) return null;
  return Object.fromEntries(SECTIONS.map((section) => [section, template[section]]));
}

// The sections of a save request. Only what was sent is returned (the rest is kept).
// -> { data } or { error }
function parseSections(body) {
  const data = {};
  for (const section of SECTIONS) {
    const value = body?.[section];
    if (value === undefined) continue;
    if (typeof value !== 'string') return { error: `${section} must be text` };
    if (value.length > MAX_SECTION_LENGTH) return { error: `${section} must be at most ${MAX_SECTION_LENGTH} characters` };
    data[section] = value;
  }
  return { data };
}

// A note with nothing written beyond its template's headings is not worth closing: a closed
// note can never be edited, only corrected with an addendum.
function hasNoContent(note) {
  const template = TEMPLATES[note.template] || TEMPLATES.blank;
  return SECTIONS.every((section) => note[section].trim() === template[section].trim());
}

module.exports = {
  SECTIONS,
  MAX_SECTION_LENGTH,
  MAX_ADDENDUM_LENGTH,
  TEMPLATES,
  templateList,
  sectionsOf,
  parseSections,
  hasNoContent
};
