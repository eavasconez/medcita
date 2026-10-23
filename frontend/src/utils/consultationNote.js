// The four parts of a SOAP note, in order (see backend/src/services/consultationNotes.js)
export const SECTIONS = [
  { name: 'subjective', letter: 'S', title: 'Subjective', hint: 'What the patient tells you: reason for the visit, symptoms, history of the illness' },
  { name: 'objective', letter: 'O', title: 'Objective', hint: 'What you observe and measure: physical exam, vital signs, results' },
  { name: 'assessment', letter: 'A', title: 'Assessment', hint: 'Your impression: diagnosis or working diagnosis' },
  { name: 'plan', letter: 'P', title: 'Plan', hint: 'What happens next: treatment, tests, follow-up' }
];

export const formatDateTime = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// The Ministry's list is in capitals ("COLERA DEBIDO A..."): shown as a sentence, stored as it came.
export const diagnosisLabel = (name) =>
  name && name === name.toUpperCase() ? name.charAt(0) + name.slice(1).toLowerCase() : name;

export const CERTAINTY_LABEL = { presumptive: 'Presumptive', definitive: 'Definitive' };
