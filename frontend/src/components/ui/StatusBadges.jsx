import React from 'react';
import Badge from './Badge';
import { statusColor, statusLabel } from '../../utils/appointmentStatus';

// The states the app talks about, each with ONE label and color wherever it appears.

// An appointment's status, in the color the calendar and its legend use
export const AppointmentStatusBadge = ({ status, size }) => (
  <Badge color={statusColor(status)} size={size}>{statusLabel(status)}</Badge>
);

// A consultation note: still being written, or closed (final)
export const NoteStatusBadge = ({ status, size }) => (
  status === 'closed'
    ? <Badge tone="neutral" size={size}>Closed</Badge>
    : <Badge tone="warning" size={size}>Draft</Badge>
);

// A patient under 18
export const MinorBadge = ({ size }) => <Badge tone="primary" size={size}>Minor</Badge>;
