import React from 'react';
import Badge from './ui/Badge';

const CONSENT_BADGE = {
  none: ['Consent pending', 'warning'],
  granted: ['Consent given', 'success'],
  outdated: ['Consent: old text', 'warning'],
  withdrawn: ['Consent withdrawn', 'danger']
};

const ConsentBadge = ({ consent }) => {
  const key = !consent ? 'none' : consent.status === 'granted' && !consent.upToDate ? 'outdated' : consent.status;
  const [label, tone] = CONSENT_BADGE[key];
  return <Badge tone={tone}>{label}</Badge>;
};

export default ConsentBadge;
