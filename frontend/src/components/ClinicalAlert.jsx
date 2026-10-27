import React from 'react';
import { AlertTriangle, Pill } from 'lucide-react';
import { SEVERITY_LABEL } from '../utils/patientRecord';

const SEVERITY_TONE = {
  severe: 'bg-red-600 text-white',
  moderate: 'bg-red-100 text-red-700',
  mild: 'bg-amber-100 text-amber-700'
};

const BANNER_SEVERITY_TONE = {
  severe: 'bg-danger text-white',
  moderate: 'bg-danger-soft text-danger-ink',
  mild: 'bg-warning-soft text-warning-ink'
};

const medicationDetail = (m) => [m.dose, m.frequency].filter(Boolean).join(', ');

// The banner pinned under the patient's header: red while there is an active allergy, amber when
// there is only regular medication, and nothing at all (no space) when there is neither. On a phone
// it drops the reaction and the dose (the clinical background below has them) so it stays short.
const Banner = ({ allergies, medications }) => (
  <div
    role="alert"
    className={`mt-3 max-h-[24vh] space-y-1.5 overflow-y-auto rounded-2xl border px-4 py-2.5 md:max-h-[30vh] ${allergies.length ? 'border-danger-line bg-danger-soft' : 'border-warning-line bg-warning-soft'}`}
  >
    {allergies.length > 0 && (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="flex shrink-0 items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-danger-ink">
          <AlertTriangle size={14} className="self-center" /> Allergies
        </p>
        <ul className="flex min-w-0 flex-1 basis-full flex-wrap gap-1.5 sm:basis-0">
          {allergies.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border border-danger-line bg-white px-2.5 py-0.5 text-[13px] font-bold text-secondary">
              {a.substance}
              {a.reaction && <span className="hidden font-medium text-slate-500 sm:inline">· {a.reaction}</span>}
              {a.severity && <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${BANNER_SEVERITY_TONE[a.severity]}`}>{SEVERITY_LABEL[a.severity]}</span>}
            </li>
          ))}
        </ul>
      </div>
    )}
    {medications.length > 0 && (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="flex shrink-0 items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-warning-ink">
          <Pill size={14} className="self-center" /> Regular medication
        </p>
        <ul className="flex min-w-0 flex-1 basis-full flex-wrap gap-1.5 sm:basis-0">
          {medications.map((m) => (
            <li key={m.id} className="rounded-lg border border-warning-line bg-white px-2.5 py-0.5 text-[13px] font-bold text-secondary">
              {m.name}
              {medicationDetail(m) && <span className="hidden font-medium text-slate-500 sm:inline"> · {medicationDetail(m)}</span>}
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);

// What a doctor must see before treating or prescribing: the allergies still active and the
// medication the patient takes regularly. `banner` is the one pinned under the patient's header
// (record, note, timeline); `compact` is the card inside the appointment of the calendar.
const ClinicalAlert = ({ summary, compact = false, banner = false }) => {
  if (!summary) return null;
  const allergies = summary.allergies.filter((a) => a.active);
  const medications = summary.medications.filter((m) => m.active);
  const none = allergies.length === 0 && medications.length === 0;

  if (banner) return none ? null : <Banner allergies={allergies} medications={medications} />;

  if (none) {
    return <p className="text-xs font-semibold text-slate-400">No allergies or regular medication recorded.</p>;
  }

  return (
    <div role="alert" className={`rounded-2xl border ${allergies.length ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'} ${compact ? 'p-4' : 'p-5'}`}>
      {allergies.length > 0 && (
        <div>
          <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-red-700">
            <AlertTriangle size={15} /> Allergies
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {allergies.map((a) => (
              <li key={a.id} className="flex items-center gap-2 bg-white rounded-xl border border-red-100 px-3 py-1.5 text-sm font-bold text-secondary">
                {a.substance}
                {a.reaction && <span className="font-medium text-slate-500">· {a.reaction}</span>}
                {a.severity && <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${SEVERITY_TONE[a.severity]}`}>{SEVERITY_LABEL[a.severity]}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {medications.length > 0 && (
        <div className={allergies.length ? 'mt-4' : ''}>
          <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-amber-700">
            <Pill size={15} /> Regular medication
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {medications.map((m) => (
              <li key={m.id} className="bg-white rounded-xl border border-amber-100 px-3 py-1.5 text-sm font-bold text-secondary">
                {m.name}
                {medicationDetail(m) && <span className="font-medium text-slate-500"> · {medicationDetail(m)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ClinicalAlert;
