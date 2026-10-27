// The patient came (or is being seen) / the visit is over, one way or the other
const ATTENDED_STATUSES = ['arrived', 'in_progress', 'completed'];
const CLOSED_STATUSES = ['completed', 'no_show'];
// Still waiting for the visit to happen; once its time has passed it should have been closed
const OPEN_STATUSES = ['pending_approval', 'scheduled', 'confirmed', 'arrived', 'in_progress'];

module.exports = { ATTENDED_STATUSES, CLOSED_STATUSES, OPEN_STATUSES };
