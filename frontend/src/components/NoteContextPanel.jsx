import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { Badge, Skeleton, useFocusTrap } from './ui';
import { MEASURES, latestValues } from '../utils/vitals';
import { byVisit } from '../utils/recordSummary';
import { diagnosisLabel } from '../utils/consultationNote';

const CATEGORY_LABEL = { personal: 'Personal', family: 'Family', surgical: 'Surgical', habit: 'Habits' };

const Block = ({ title, loading, empty, children }) => (
  <section className="rounded-2xl border border-slate-100 bg-white p-4">
    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">{title}</h4>
    {loading ? (
      <div aria-busy="true"><span className="sr-only">Loading...</span><Skeleton className="h-10 w-full" /></div>
    ) : empty ? (
      <p className="text-sm font-medium text-slate-300">{empty}</p>
    ) : children}
  </section>
);

// What the doctor wants at hand while writing: the history, the latest vital signs and the diagnoses
// of the earlier consultations. It only reads what the screen already loaded (`summary`, `readings`
// and `notes` are null while they arrive) and never holds the writing back. As a `drawer` (on a
// phone) it covers the page, keeps the keyboard inside and closes with Escape.
const NoteContextPanel = ({ id, patientId, appointmentId, summary, readings, notes, drawer = false, onClose }) => {
  const panelRef = useRef(null);
  useFocusTrap(panelRef, { active: drawer, onEscape: onClose });

  const latest = readings ? latestValues(readings) : {};
  const shown = MEASURES.filter((m) => latest[m.key]);
  const history = summary?.backgrounds || [];
  const earlier = notes ? byVisit(notes).filter((n) => n.appointmentId !== appointmentId && n.principalDiagnosis).slice(0, 5) : [];

  const body = (
    <div ref={panelRef} id={id} role={drawer ? 'dialog' : 'complementary'} aria-modal={drawer ? 'true' : undefined} aria-label="Patient context" tabIndex={-1}
      className={drawer ? 'fixed inset-y-0 right-0 z-[90] flex w-[88%] max-w-sm flex-col bg-slate-50 shadow-2xl animate-in slide-in-from-right duration-200' : 'space-y-3'}>
      {drawer && (
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-black uppercase tracking-widest text-secondary">Context</h3>
          <button onClick={onClose} aria-label="Close context" className="p-2 hover:bg-white rounded-xl"><X size={18} className="text-slate-400" /></button>
        </div>
      )}
      <div className={drawer ? 'flex-1 space-y-3 overflow-y-auto p-4' : 'space-y-3'}>
        <Block title="History" loading={!summary} empty={history.length === 0 && 'No history recorded'}>
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="flex items-baseline gap-2">
                <Badge size="sm" className="shrink-0">{CATEGORY_LABEL[h.category]}</Badge>
                <span className="text-sm font-bold text-secondary break-words">{h.description}{h.noted ? <span className="font-medium text-slate-400"> · {h.noted}</span> : null}</span>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Latest vital signs" loading={!readings} empty={shown.length === 0 && 'No vital signs recorded'}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            {shown.map((m) => (
              <div key={m.key}>
                <dt className="text-[10px] font-black uppercase tracking-widest text-slate-400">{m.short || m.label}</dt>
                <dd className="text-sm font-black text-secondary whitespace-nowrap">{latest[m.key].value} <span className="text-[11px] font-bold text-slate-400">{m.unit}</span></dd>
                <dd className="text-[10px] font-semibold text-slate-400">{new Date(latest[m.key].at).toLocaleDateString([], { dateStyle: 'medium' })}</dd>
              </div>
            ))}
          </dl>
        </Block>

        <Block title="Diagnoses of earlier visits" loading={!notes} empty={earlier.length === 0 && 'No earlier diagnoses'}>
          <ul className="space-y-2">
            {earlier.map((n) => (
              <li key={n.id}>
                <Link to={`/patients/${patientId}/appointments/${n.appointmentId}/note`} className="block hover:underline">
                  <span className="text-sm font-bold text-secondary">{n.principalDiagnosis.code ? `${n.principalDiagnosis.code} ` : ''}{diagnosisLabel(n.principalDiagnosis.name)}</span>
                  <span className="block text-[11px] font-semibold text-slate-400">{n.appointment.date}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Block>
      </div>
    </div>
  );

  if (!drawer) return body;
  return (
    <div className="md:hidden">
      <div className="fixed inset-0 z-[80] bg-slate-900/60" onClick={onClose} aria-hidden="true" />
      {body}
    </div>
  );
};

export default NoteContextPanel;
