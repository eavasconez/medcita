// What the Resumen of the record shows, worked out from what the screen already has (the notes list,
// the vital signs, the history): no endpoint of its own.

const visitOf = (note) => `${note.appointment?.date || ''} ${note.appointment?.time || ''}`;

// The notes, the most recent visit first
export const byVisit = (notes) => [...notes].sort((a, b) => visitOf(b).localeCompare(visitOf(a)));

// The note of the latest visit
export const latestNote = (notes) => byVisit(notes)[0] || null;

// The main diagnosis of the latest notes, each once (the same code or name in several visits counts
// as one, with the date of its latest visit)
export function recentDiagnoses(notes, limit = 5) {
  const seen = new Map();
  for (const note of byVisit(notes)) {
    const d = note.principalDiagnosis;
    if (!d) continue;
    const key = d.code || d.name;
    if (!seen.has(key)) seen.set(key, { code: d.code, name: d.name, visit: note.appointment?.date, noteStatus: note.status });
  }
  return [...seen.values()].slice(0, limit);
}
