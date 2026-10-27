import React, { useState, useContext, lazy, Suspense } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import LoadError from './LoadError';
import VitalsForm from './VitalsForm';
import { METRICS, MEASURES, trends, cellOf, describeChange, directionOf } from '../utils/vitals';
import { formatDateTime } from '../utils/consultationNote';
import { EmptyState, Skeleton, useConfirm } from './ui';
import { Plus, Ban, ArrowUp, ArrowDown, Minus } from 'lucide-react';

// The charts bring a heavy library: only downloaded when a patient has something to chart
const VitalsChart = lazy(() => import('./VitalsChart'));

const shortDate = (iso) => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
const shortTime = (iso) => new Date(iso).toLocaleTimeString([], { timeStyle: 'short' });

// One measurement: its latest value and date and how it moved since the one before. A card with a
// chart is a button that picks the chart; the height has none and is a plain card.
const TrendCard = ({ measure, trend, selected, onSelect }) => {
  const { latest, previous, change } = trend || {};
  const direction = change ? directionOf(change) : 0;
  const Arrow = direction > 0 ? ArrowUp : direction < 0 ? ArrowDown : Minus;
  const selectable = Boolean(measure.metric && trend);

  const body = (
    <>
      <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">{measure.label}</span>
      {latest ? (
        <>
          <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-xl font-black text-secondary whitespace-nowrap">{latest.value}</span>
            <span className="text-xs font-bold text-slate-400">{measure.unit}</span>
          </span>
          <span className="block text-[10px] font-semibold text-slate-400 mt-0.5">{shortDate(latest.at)}</span>
          <span className="mt-2 flex items-start gap-1 text-[11px] font-bold text-slate-500">
            {change ? (
              <>
                <Arrow size={12} className="mt-px shrink-0" aria-hidden="true" />
                <span>{describeChange(change)} since {shortDate(previous.at)}</span>
              </>
            ) : (
              <span className="font-semibold text-slate-400">Single reading — no trend yet</span>
            )}
          </span>
        </>
      ) : (
        <>
          <span className="block text-xl font-black text-slate-200 mt-1">—</span>
          <span className="block text-[11px] font-semibold text-slate-300 mt-2">Not recorded</span>
        </>
      )}
    </>
  );

  const base = 'rounded-2xl p-4 text-left border-2';
  if (!selectable) return <div className={`${base} bg-slate-50 border-transparent`}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${measure.label}: show the chart`}
      className={`${base} transition-colors ${selected ? 'bg-primary/5 border-primary' : 'bg-slate-50 border-transparent hover:border-slate-200'}`}
    >
      {body}
    </button>
  );
};

// The vital signs of a patient on the record screen: a card per measurement with its trend, the chart
// of the one picked, the whole history as a table and the form for a new set. A reading taken by
// mistake is voided (it stays in the history, struck through, and leaves the cards and the charts).
const VitalsSection = ({ patientId, vitals, onError }) => {
  const { token, user } = useContext(AuthContext);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const { askReason } = useConfirm();

  const { readings, truncated, error, reload } = vitals;
  if (error) return <LoadError message="We couldn't load the vital signs." onRetry={reload} />;
  if (!readings) {
    return (
      <div aria-busy="true">
        <span className="sr-only">Loading...</span>
        <Skeleton className="h-40 w-full rounded-3xl" />
      </div>
    );
  }

  const byMeasure = trends(readings);
  // The chart shows the picked measurement, or else the first one that has something to chart
  const metricKey = picked || MEASURES.find((m) => m.metric && byMeasure[m.key])?.metric || METRICS[0].key;
  const metric = METRICS.find((m) => m.key === metricKey);
  const shown = showAll ? readings : readings.slice(0, 8);

  const voidReading = async (reading) => {
    const reason = await askReason({
      title: 'Void this reading?',
      message: 'It stays in the history, marked as voided, and leaves the charts.',
      confirmLabel: 'Void reading',
      reason: { label: 'Reason (optional)', placeholder: 'Ex: Entered for the wrong patient' }
    });
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
      <div className="flex items-center justify-between gap-4 mb-5">
        <p className="hidden min-w-0 text-xs font-semibold text-slate-400 sm:block">Metric units. Each card shows the latest value and how it changed since the one before.</p>
        {!adding && (
          <button onClick={() => setAdding(true)} className="ml-auto shrink-0 whitespace-nowrap flex items-center gap-1 text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">
            <Plus size={14} /> Record vitals
          </button>
        )}
      </div>

      {adding && <VitalsForm patientId={patientId} onSaved={async () => { await reload(); setAdding(false); }} onCancel={() => setAdding(false)} />}

      {readings.length === 0 ? (
        !adding && (
          <EmptyState
            className="py-8 px-4"
            title="No vital signs recorded"
            action={(
              <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">
                <Plus size={14} /> Record the first vital signs
              </button>
            )}
          />
        )
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {MEASURES.map((measure) => (
              <TrendCard key={measure.key} measure={measure} trend={byMeasure[measure.key]} selected={measure.metric === metricKey} onSelect={() => setPicked(measure.metric)} />
            ))}
          </div>

          <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
            <VitalsChart readings={readings} metric={metric} />
          </Suspense>

          <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mt-8 mb-3">History</h4>
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Vital signs history, newest first</caption>
              <thead>
                <tr className="border-b border-slate-100 align-bottom">
                  <th scope="col" className="py-2 pr-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Measured</th>
                  {MEASURES.map((m) => (
                    <th key={m.key} scope="col" className="py-2 px-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">
                      {m.short || m.label}
                      <span className="block font-bold normal-case tracking-normal text-slate-300">{m.unit}</span>
                    </th>
                  ))}
                  <th scope="col" className="py-2 pl-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Recorded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {shown.map((r) => {
                  const voided = Boolean(r.voidedAt);
                  return (
                    <tr key={r.id} className="align-top">
                      <th scope="row" className={`py-3 pr-3 font-black whitespace-nowrap ${voided ? 'text-slate-300 line-through' : 'text-secondary'}`}>
                        {shortDate(r.measuredAt)}
                        <span className="block text-[11px] font-semibold text-slate-400">{shortTime(r.measuredAt)}</span>
                      </th>
                      {MEASURES.map((m) => {
                        const cell = cellOf(r, m.key);
                        return (
                          <td key={m.key} className={`py-3 px-1.5 font-semibold whitespace-nowrap ${voided ? 'line-through' : ''} ${cell && !voided ? 'text-secondary' : voided && cell ? 'text-slate-300' : 'text-slate-200'}`}>{cell || '—'}</td>
                        );
                      })}
                      <td className="py-3 pl-3 min-w-32">
                        <p className="text-[11px] font-semibold text-slate-400">{r.recordedByName}</p>
                        {voided && <p className="text-[11px] font-semibold text-slate-400">Voided by {r.voidedByName}{r.voidReason ? `: ${r.voidReason}` : ''}</p>}
                        {!voided && (r.recordedById === user?.id || user?.role === 'admin') && (
                          <button onClick={() => voidReading(r)} aria-label={`Void the reading of ${formatDateTime(r.measuredAt)}`} className="mt-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500">
                            <Ban size={12} /> Void
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
