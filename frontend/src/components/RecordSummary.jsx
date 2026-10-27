import React from 'react';
import { Link } from 'react-router-dom';
import { Badge, NoteStatusBadge, Skeleton } from './ui';
import { latestNote, recentDiagnoses } from '../utils/recordSummary';
import { latestValues } from '../utils/vitals';
import { diagnosisLabel, formatDateTime } from '../utils/consultationNote';
import { ArrowRight } from 'lucide-react';

const CATEGORY_LABEL = { personal: 'Personal', family: 'Family', surgical: 'Surgical', habit: 'Habits' };

const VITALS = [
  ['weightKg', 'Weight', 'kg'], ['bmi', 'BMI', ''], ['bp', 'Blood pressure', 'mmHg'], ['heartRate', 'Heart rate', 'bpm'],
  ['temperatureC', 'Temperature', '°C'], ['oxygenSaturation', 'SpO₂', '%']
];

const Card = ({ title, loading, empty, link, children }) => (
  <div className="bg-white rounded-3xl border border-slate-100 p-6 flex flex-col">
    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-4">{title}</h4>
    {loading ? (
      <div aria-busy="true"><span className="sr-only">Loading...</span><Skeleton className="h-16 w-full" /></div>
    ) : empty ? (
      <p className="text-sm font-medium text-slate-300">{empty}</p>
    ) : children}
    {link && (
      <button onClick={link.onClick} className="mt-auto pt-4 self-start flex items-center gap-1 text-xs font-black text-primary hover:underline">
        {link.label} <ArrowRight size={13} />
      </button>
    )}
  </div>
);

// The most important of the record at a glance, for the roles that read it: the latest consultation,
// the latest vital signs, the main diagnoses of the latest notes and the key history. Each block
// says where the rest is. `notes`, `readings` and `summary` are null while they load.
const RecordSummary = ({ patientId, notes, readings, summary, onGoTo }) => {
  const last = notes && latestNote(notes);
  const diagnoses = notes ? recentDiagnoses(notes) : [];
  const latest = readings ? latestValues(readings) : {};
  const shownVitals = VITALS.filter(([key]) => latest[key]);
  const history = summary?.backgrounds || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Last consultation" loading={!notes} empty={!last && 'No consultations yet'} link={{ label: 'All consultations', onClick: () => onGoTo('consultations') }}>
        {last && (
          <>
            <p className="font-black text-secondary">{last.appointment.date} · {last.appointment.time}</p>
            <p className="text-sm font-medium text-slate-500 mt-0.5">
              {last.authorName} · {formatDateTime(last.status === 'closed' ? last.closedAt : last.updatedAt)}
            </p>
            {last.principalDiagnosis && (
              <p className="text-sm font-bold text-secondary mt-2">{last.principalDiagnosis.code ? `${last.principalDiagnosis.code} ` : ''}{diagnosisLabel(last.principalDiagnosis.name)}</p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <NoteStatusBadge status={last.status} />
              <Link to={`/patients/${patientId}/appointments/${last.appointmentId}/note`} className="text-xs font-black text-primary hover:underline">Open note</Link>
            </div>
          </>
        )}
      </Card>

      <Card title="Latest vital signs" loading={!readings} empty={shownVitals.length === 0 && 'No vital signs recorded'} link={{ label: 'All vital signs', onClick: () => onGoTo('vitals') }}>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
          {shownVitals.map(([key, label, unit]) => (
            <div key={key}>
              <dt className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</dt>
              <dd className="text-base font-black text-secondary whitespace-nowrap">{latest[key].value} <span className="text-xs font-bold text-slate-400">{unit}</span></dd>
              <dd className="text-[10px] font-semibold text-slate-400">{new Date(latest[key].at).toLocaleDateString([], { dateStyle: 'medium' })}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Recent diagnoses" loading={!notes} empty={diagnoses.length === 0 && 'No diagnoses recorded yet'} link={{ label: 'All consultations', onClick: () => onGoTo('consultations') }}>
        <ul className="space-y-2">
          {diagnoses.map((d) => (
            <li key={d.code || d.name} className="flex flex-wrap items-baseline gap-x-2">
              {d.code && <span className="text-xs font-black text-slate-400">{d.code}</span>}
              <span className="text-sm font-bold text-secondary">{diagnosisLabel(d.name)}</span>
              {d.visit && <span className="text-[11px] font-semibold text-slate-400">{d.visit}</span>}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Key history" loading={!summary} empty={history.length === 0 && 'No history recorded'} link={{ label: 'All background', onClick: () => onGoTo('background') }}>
        <ul className="space-y-2">
          {history.slice(0, 5).map((h) => (
            <li key={h.id} className="flex items-baseline gap-2">
              <Badge size="sm" className="shrink-0">{CATEGORY_LABEL[h.category]}</Badge>
              <span className="text-sm font-bold text-secondary break-words">{h.description}{h.noted ? <span className="font-medium text-slate-400"> · {h.noted}</span> : null}</span>
            </li>
          ))}
        </ul>
        {history.length > 5 && <p className="mt-2 text-xs font-semibold text-slate-400">and {history.length - 5} more</p>}
      </Card>
    </div>
  );
};

export default RecordSummary;
