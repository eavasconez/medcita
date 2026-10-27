// The patients a person opened lately, for the strip above the patient list (S10.5-07). They are
// kept in this browser only, per clinic AND per user (a second person on the same computer does not
// see them, nor another clinic's), and only the id and the name: nothing clinical and no contact
// data. They are cleared when the session ends.
const PREFIX = 'medcita:recent-patients:';
export const MAX_RECENT = 8;

const keyOf = (user) => (user?.id && user?.clinic?.id ? `${PREFIX}${user.clinic.id}:${user.id}` : null);

export function readRecentPatients(user) {
  const key = keyOf(user);
  if (!key) return [];
  try {
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

const write = (user, list) => {
  const key = keyOf(user);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, MAX_RECENT).map((p) => ({ id: p.id, name: p.name }))));
  } catch {
    // storage full or blocked: the strip just stays as it was
  }
};

// The patient goes to the front; one already there is moved, not repeated
export function rememberPatient(user, patient) {
  if (!patient?.id || !patient?.name) return;
  write(user, [{ id: patient.id, name: patient.name }, ...readRecentPatients(user).filter((p) => p.id !== patient.id)]);
}

export function forgetPatient(user, patientId) {
  write(user, readRecentPatients(user).filter((p) => p.id !== patientId));
}

// Ends of a session: nothing of anyone is left in the browser
export function clearRecentPatients() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch {
    // nothing to clear
  }
}
