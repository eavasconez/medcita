import React, { useState, useContext, lazy, Suspense } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import LoadError from './LoadError';
import VitalsForm from './VitalsForm';
import { METRICS, latestValues, describeReading } from '../utils/vitals';
import { formatDateTime } from '../utils/consultationNote';
import { Plus, Ban } from 'lucide-react';

// The charts bring a heavy library: only downloaded when a patient has something to chart
const VitalsChart = lazy(() => import('./VitalsChart'));

const LATEST = [
  ['weightKg', 'Weight', 'kg'], ['heightCm', 'Height', 'cm'], ['bmi', 'BMI', 'kg/m²'], ['bp', 'Blood pressure', 'mmHg'],
  ['heartRate', 'Heart rate', 'bpm'], ['respiratoryRate', 'Respiratory rate', 'rpm'], ['temperatureC', 'Temperature', '°C'], ['oxygenSaturation', 'Oxygen saturation', '%']
];

// The vital signs of a patient on the record screen: the latest value of each, a chart per
// measurement, the whole history and the form for a new set. A reading taken by mistake is voided
// (it stays in the history, struck through, and leaves the charts).
const VitalsSection = ({ patientId, vitals, onError }) => {
  const { token, user } = useContext(AuthContext);
  const [adding, setAdding] = useState(false);
  const [metricKey, setMetricKey] = useState('weight');
  const [showAll, setShowAll] = useState(false);

  const { readings, truncated, error, reload } = vitals;
  if (error) return <LoadError message="We couldn't load the vital signs." onRetry={reload} />;
  if (!readings) return <p className="text-slate-300 font-semibold animate-pulse">Loading...</p>;

  const latest = latestValues(readings);
  const metric = METRICS.find((m) => m.key === metricKey);
  const shown = showAll ? readings : readings.slice(0, 8);

  const voidReading = async (reading) => {
    const reason = window.prompt('Void this reading? It stays in the history, marked. Reason (optional):');
    if (reason === null) return;
    try {
      await axios.post(`${API_BASE_URL}/api/patients/${patientId}/clinical/vitals/${reading.id}/void`, { reason }, { headers: { Authorization: `Bearer ${token}` } });
      await reload();
    } catch (err) {
      onError(err.response?.data?.error || 'We couldn\'t void the reading');
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-100 p-6">
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs font-semibold text-slate-400">Metric units. Each value shows the day it was last taken.</p>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">
            <Plus size={14} /> Record vitals
          </button>
        )}
      </div>

      {adding && <VitalsForm patientId={patientId} onSaved={async () => { await reload(); setAdding(false); }} onCancel={() => setAdding(false)} />}

      {readings.length === 0 ? (
        <p className="text-sm font-medium text-slate-300">No vital signs recorded</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {LATEST.map(([key, label, unit]) => (
              <div key={key} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                {latest[key] ? (
                  <>
                    <p className="text-xl font-black text-secondary mt-1">{latest[key].value} <span className="text-xs font-bold text-slate-400">{unit}</span></p>
                    <p className="text-[10px] font-semibold text-slate-400 mt-0.5">{new Date(latest[key].at).toLocaleDateString([], { dateStyle: 'medium' })}</p>
                  </>
                ) : <p className="text-xl font-black text-slate-200 mt-1">—</p>}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Chart">
            {METRICS.map((m) => (
              <button key={m.key} role="tab" aria-selected={m.key === metricKey} onClick={() => setMetricKey(m.key)}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${m.key === metricKey ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {m.label}
              </button>
            ))}
          </div>
          <Suspense fallback={<div className="h-64 animate-pulse bg-slate-50 rounded-2xl" />}>
            <VitalsChart readings={readings} metric={metric} />
          </Suspense>

          <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mt-8 mb-3">History</h4>
          <ul className="divide-y divide-slate-50">
            {shown.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-start gap-x-4 gap-y-1">
                <span className={`w-44 text-sm font-black ${r.voidedAt ? 'text-slate-300 line-through' : 'text-secondary'}`}>{formatDateTime(r.measuredAt)}</span>
                <div className={`flex-1 min-w-56 ${r.voidedAt ? 'opacity-50' : ''}`}>
                  <p className={`text-sm font-semibold text-secondary ${r.voidedAt ? 'line-through' : ''}`}>{describeReading(r)}</p>
                  <p className="text-[11px] font-semibold text-slate-400">
                    {r.recordedByName}
                    {r.voidedAt && ` · voided by ${r.voidedByName}${r.voidReason ? `: ${r.voidReason}` : ''}`}
                  </p>
                </div>
                {!r.voidedAt && (r.recordedById === user?.id || user?.role === 'admin') && (
                  <button onClick={() => voidReading(r)} aria-label={`Void the reading of ${formatDateTime(r.measuredAt)}`} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 px-2 py-1">
                    <Ban size={12} /> Void
                  </button>
                )}
              </li>
            ))}
          </ul>
          {readings.length > 8 && (
            <button onClick={() => setShowAll(!showAll)} className="mt-3 text-xs font-black text-primary hover:underline">{showAll ? 'Show fewer' : `Show all ${readings.length}`}</button>
          )}
          {truncated && <p className="mt-2 text-xs font-semibold text-amber-700">Only the newest 500 readings are shown.</p>}
        </>
      )}
    </div>
  );
};

export default VitalsSection;
