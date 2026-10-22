import React from 'react';
import { AlertTriangle, Pill } from 'lucide-react';
import { SEVERITY_LABEL } from '../utils/patientRecord';

const SEVERITY_TONE = {
  severe: 'bg-red-600 text-white',
  moderate: 'bg-red-100 text-red-700',
  mild: 'bg-amber-100 text-amber-700'
};

// What a doctor must see before treating or prescribing: the allergies still active and the
// medication the patient takes regularly. Shown on the record and on the appointment.
const ClinicalAlert = ({ summary, compact = false }) => {
  if (!summary) return null;
  const allergies = summary.allergies.filter((a) => a.active);
  const medications = summary.medications.filter((m) => m.active);

  if (allergies.length === 0 && medications.length === 0) {
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
                {(m.dose || m.frequency) && <span className="font-medium text-slate-500"> · {[m.dose, m.frequency].filter(Boolean).join(', ')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ClinicalAlert;
