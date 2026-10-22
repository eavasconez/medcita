import React from 'react';

const CONSENT_BADGE = {
  none: ['Consent pending', 'bg-amber-50 text-amber-700'],
  granted: ['Consent given', 'bg-emerald-50 text-emerald-700'],
  outdated: ['Consent: old text', 'bg-amber-50 text-amber-700'],
  withdrawn: ['Consent withdrawn', 'bg-red-50 text-red-600']
};

const ConsentBadge = ({ consent }) => {
  const key = !consent ? 'none' : consent.status === 'granted' && !consent.upToDate ? 'outdated' : consent.status;
  const [label, tone] = CONSENT_BADGE[key];
  return <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${tone}`}>{label}</span>;
};

export default ConsentBadge;
