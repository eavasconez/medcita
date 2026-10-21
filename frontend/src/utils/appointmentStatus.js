// How each appointment status is shown: label, calendar colour and the colour of the
// status panel of the appointment modal. One place so the calendar, the legend, the
// filter and the modal agree.
export const STATUS = {
  pending_approval: { label: 'Pending', color: '#f59e0b' },
  scheduled: { label: 'Scheduled', color: '#0ea5e9' },
  confirmed: { label: 'Confirmed', color: '#10b981' },
  arrived: { label: 'Arrived', color: '#6366f1' },
  in_progress: { label: 'In consultation', color: '#8b5cf6' },
  completed: { label: 'Completed', color: '#64748b' },
  no_show: { label: 'No-show', color: '#ef4444' },
  cancelled: { label: 'Cancelled', color: '#94a3b8' }
};

export const statusLabel = (status) => STATUS[status]?.label || 'Pending';
export const statusColor = (status) => STATUS[status]?.color || '#1e293b';

// The next steps offered for an appointment, as [status, button label]. "No-show" only
// makes sense once the time has come, so the caller says whether it already has.
export function nextSteps(status, { started }) {
  if (status === 'cancelled') return [];
  // A patient marked as missing who turned up late: the record can be corrected
  if (status === 'no_show') return [['completed', 'Patient was seen']];
  const steps = [];
  if (status === 'pending_approval' || status === 'scheduled') steps.push(['confirmed', 'Confirm appointment']);
  if (['pending_approval', 'scheduled', 'confirmed'].includes(status)) steps.push(['arrived', 'Patient arrived']);
  if (['arrived'].includes(status)) steps.push(['in_progress', 'Start consultation']);
  if (['confirmed', 'arrived', 'in_progress', 'pending_approval', 'scheduled'].includes(status)) steps.push(['completed', 'Mark as completed']);
  if (started && !['completed', 'no_show', 'arrived', 'in_progress'].includes(status)) steps.push(['no_show', 'Patient did not come']);
  return steps;
}
