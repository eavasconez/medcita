// Who may see the clinical record (allergies, notes, vital signs, timeline): the doctors and the
// admins of the clinic. The secretary books appointments and never sees what was said in the
// consultation. This mirrors CLINICAL_ROLES in backend/src/middleware/clinicalAccess.js, which is
// the one that really decides (it answers 403 and re-reads the role on every request); the screens
// use this only to not ask for what they would be refused and to not paint what they could not fill.
export const CLINICAL_ROLES = ['doctor', 'admin'];

export const canViewClinical = (user) => CLINICAL_ROLES.includes(user?.role);
