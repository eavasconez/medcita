import React from 'react';
import { Plus } from 'lucide-react';
import { EmptyState } from './ui';
import { MEASURES, cellOf } from '../utils/vitals';
import { formatDateTime } from '../utils/consultationNote';

// The measurements taken at one visit, as shown on its consultation note: each set with who took it
// and when, and one chip per value (with its unit). `onRecord` opens the form from the empty state.
const VisitVitals = ({ readings, onRecord }) => {
  if (readings.length === 0) {
    return (
      <EmptyState
        className="py-6 px-4"
        title="No measurements recorded at this visit"
        action={onRecord && (
          <button onClick={onRecord} className="inline-flex items-center gap-1 text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">
            <Plus size={14} /> Record the first measurements
          </button>
        )}
      />
    );
  }

  return (
    <ul className="space-y-3">
      {readings.map((r) => (
        <li key={r.id} className="rounded-2xl bg-slate-50 p-4">
          <p className="text-[11px] font-semibold text-slate-400">{formatDateTime(r.measuredAt)} · {r.recordedByName}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {MEASURES.filter((m) => cellOf(r, m.key)).map((m) => (
              <li key={m.key} className="rounded-xl border border-slate-100 bg-white px-3 py-1.5 text-sm font-bold text-secondary">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{m.short || m.label}</span>{' '}
                {cellOf(r, m.key)} <span className="text-xs font-semibold text-slate-400">{m.unit}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
};

export default VisitVitals;
