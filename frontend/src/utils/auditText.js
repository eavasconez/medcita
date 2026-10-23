// Turns an entry of the audit log (see backend/src/services/auditLog.js) into text a
// person can read, and the User-Agent into something short like "Chrome on Linux".

export const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'login', label: 'Signed in' },
  { value: 'login_failed', label: 'Failed sign-in' },
  { value: 'password_change', label: 'Password changed' },
  { value: 'password_reset', label: 'Password reset' },
  { value: 'create', label: 'Created' },
  { value: 'update', label: 'Updated' },
  { value: 'cancel', label: 'Cancelled' },
  { value: 'delete', label: 'Deleted' },
  { value: 'read', label: 'Viewed' }
];

const ENTITY_NOUN = { appointment: 'an appointment', patient: 'a patient', user: 'an account', invitation: 'an invitation', consent: 'a patient\'s consent', patient_export: 'a patient\'s data', appointment_type: 'an appointment type', schedule_block: 'days off', reminder_settings: 'the reminder settings', clinical_record: 'a patient\'s clinical record', patient_allergy: 'an allergy', patient_medication: 'a regular medication', patient_background: 'a history entry' };
const VERB = { create: 'Created', update: 'Updated', cancel: 'Cancelled', delete: 'Deleted', read: 'Viewed' };

const SESSION_TITLES = {
  login: 'Signed in',
  login_failed: 'Failed sign-in attempt',
  password_change: 'Changed their password',
  password_reset: 'Reset their password with an emailed link'
};

// Visual weight of each action: what deserves a second look is red or amber.
export const ACTION_TONE = {
  login: 'bg-emerald-100 text-emerald-700',
  login_failed: 'bg-red-100 text-red-600',
  password_change: 'bg-amber-100 text-amber-700',
  password_reset: 'bg-amber-100 text-amber-700',
  create: 'bg-blue-100 text-blue-600',
  update: 'bg-slate-100 text-slate-600',
  cancel: 'bg-orange-100 text-orange-600',
  delete: 'bg-red-100 text-red-600',
  read: 'bg-purple-100 text-purple-600'
};

export function entryTitle(entry) {
  if (SESSION_TITLES[entry.action]) return SESSION_TITLES[entry.action];
  const noun = ENTITY_NOUN[entry.entity] || entry.entity;
  if (entry.entity === 'invitation') {
    if (entry.action === 'create') return 'Invited someone to the clinic';
    if (entry.action === 'update') return 'Updated an invitation';
    if (entry.action === 'delete') return 'Cancelled an invitation';
  }
  if (entry.entity === 'schedule_block') return entry.action === 'delete' ? 'Opened blocked days again' : 'Blocked days in the agenda';
  if (entry.entity === 'reminder_settings') return 'Changed the reminder settings';
  if (entry.entity === 'patient_export') return 'Exported a patient\'s data';
  if (entry.entity === 'consent') return entry.changes?.granted?.to === false ? 'Recorded a patient\'s consent withdrawal' : 'Recorded a patient\'s consent';
  return `${VERB[entry.action] || entry.action} ${noun}`;
}

// "date: 2026-10-22 → 2026-10-23", "role: doctor → secretary", "phone changed"
export function entryDetails(entry) {
  const details = [];
  if (entry.doctor?.name) details.push(`Agenda of ${entry.doctor.name}`);
  for (const [field, change] of Object.entries(entry.changes || {})) {
    if (change.changed) details.push(`${field} changed`);
    else if ('from' in change && 'to' in change) details.push(`${field}: ${change.from ?? '—'} → ${change.to ?? '—'}`);
    else if ('to' in change) details.push(`${field}: ${change.to ?? '—'}`);
    else if ('from' in change) details.push(`${field} was ${change.from ?? '—'}`);
  }
  return details;
}

export function shortBrowser(userAgent) {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /OPR\//.test(userAgent) ? 'Opera'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : null;
  const system = /Windows/.test(userAgent) ? 'Windows'
    : /Android/.test(userAgent) ? 'Android'
    : /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Mac OS X/.test(userAgent) ? 'macOS'
    : /Linux/.test(userAgent) ? 'Linux'
    : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser || system || userAgent.slice(0, 40);
}
