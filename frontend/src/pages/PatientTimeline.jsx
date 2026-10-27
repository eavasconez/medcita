import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import Layout from '../components/Layout';
import LoadError from '../components/LoadError';
import PatientHeader from '../components/PatientHeader';
import useClinicalSummary from '../utils/useClinicalSummary';
import { canViewClinical } from '../utils/clinicalAccess';
import { AppointmentStatusBadge, EmptyState } from '../components/ui';
import { describeReading } from '../utils/vitals';
import { diagnosisLabel, formatDateTime } from '../utils/consultationNote';
import { METHOD_LABEL } from '../utils/consent';
import { CalendarDays, FileText, Activity, ShieldCheck, MessageSquarePlus, Lock, Star } from 'lucide-react';

const FILTERS = [
  { key: '', label: 'Everything' },
  { key: 'appointment', label: 'Visits' },
  { key: 'note,addendum', label: 'Notes' },
  { key: 'vitals', label: 'Vital signs' },
  { key: 'consent', label: 'Consent' }
];

const ICON = {
  appointment: [CalendarDays, 'bg-sky-100 text-sky-600'],
  note: [FileText, 'bg-indigo-100 text-indigo-600'],
  addendum: [MessageSquarePlus, 'bg-violet-100 text-violet-600'],
  vitals: [Activity, 'bg-emerald-100 text-emerald-600'],
  consent: [ShieldCheck, 'bg-amber-100 text-amber-600']
};

const monthOf = (iso) => new Date(iso).toLocaleDateString([], { month: 'long', year: 'numeric' });

// What each kind of event says, and where it leads
const Event = ({ event, patientId }) => {
  const noteLink = (appointmentId, label) => (
    <Link to={`/patients/${patientId}/appointments/${appointmentId}/note`} className="text-xs font-black text-primary hover:underline">{label}</Link>
  );

  switch (event.type) {
    case 'appointment':
      return (
        <>
          <p className="font-black text-secondary">
            Visit · {event.date} {event.time}
            <span className="ml-2 align-middle"><AppointmentStatusBadge status={event.status} size="sm" /></span>
          </p>
          <p className="text-sm font-medium text-slate-500">{event.doctor}{event.appointmentType ? ` · ${event.appointmentType}` : ''}</p>
          {event.status !== 'cancelled' && noteLink(event.id, event.noteId ? 'Open the note' : 'Write the note')}
        </>
      );
    case 'note':
      return (
        <>
          <p className="font-black text-secondary">Consultation note {event.status === 'closed' ? 'closed' : 'draft'} · visit of {event.visit}</p>
          <p className="text-sm font-medium text-slate-500">
            {event.status === 'closed' ? `Closed by ${event.closedByName}` : `Being written by ${event.authorName}`}
            {event.addendaCount > 0 ? ` · ${event.addendaCount} ${event.addendaCount === 1 ? 'addendum' : 'addenda'}` : ''}
          </p>
          {event.diagnoses.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {event.diagnoses.map((d, i) => (
                <li key={`${d.code}-${i}`} className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1 text-xs font-bold text-secondary">
                  {d.kind === 'primary' && <Star size={11} className="text-primary" />}
                  {d.code && <span className="text-slate-400">{d.code}</span>}
                  {diagnosisLabel(d.name)}
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{d.certainty === 'definitive' ? 'definitive' : 'presumptive'}</span>
                </li>
              ))}
            </ul>
          )}
          {noteLink(event.appointmentId, 'Open the note')}
        </>
      );
    case 'addendum':
      return (
        <>
          <p className="font-black text-secondary">Addendum by {event.authorName}</p>
          <p className="text-sm font-medium text-slate-500 whitespace-pre-wrap">{event.text}</p>
          {noteLink(event.appointmentId, 'Open the note')}
        </>
      );
    case 'vitals':
      return (
        <>
          <p className={`font-black ${event.voided ? 'text-slate-300 line-through' : 'text-secondary'}`}>Vital signs{event.voided ? ' (voided)' : ''}</p>
          <p className={`text-sm font-medium ${event.voided ? 'text-slate-300 line-through' : 'text-slate-500'}`}>{describeReading(event.reading)}</p>
          <p className="text-[11px] font-semibold text-slate-400">{event.recordedByName}</p>
        </>
      );
    default: // consent
      return (
        <>
          <p className="font-black text-secondary">Health-data consent {event.granted ? 'given' : 'withdrawn'}</p>
          <p className="text-sm font-medium text-slate-500">{METHOD_LABEL[event.method] || event.method} · text {event.documentVersion} · recorded by {event.recordedByName}</p>
        </>
      );
  }
};

// The story of one patient in order: visits, notes with their diagnoses, addenda, vital signs and
// consent events. For doctors and admins; every time it is opened is a read the clinic audits.
const PatientTimeline = () => {
  const { id } = useParams();
  const { token, user } = useContext(AuthContext);
  // The secretary never reads clinical data: the screen does not ask, it just says so
  const allowed = canViewClinical(user);
  const [patient, setPatient] = useState(null);
  const [events, setEvents] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [filter, setFilter] = useState('');
  const [state, setState] = useState(allowed ? 'loading' : 'denied'); // loading | ready | error | denied | notfound
  const [loadingMore, setLoadingMore] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };
  const url = `${API_BASE_URL}/api/patients/${id}/clinical/timeline`;

  const load = useCallback(async () => {
    if (!allowed) return;
    setState('loading');
    try {
      const [who, page] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/patients/${id}`, { headers }),
        axios.get(url, { headers, params: { limit: 50, ...(filter && { types: filter }) } })
      ]);
      setPatient(who.data.patient);
      setEvents(page.data.events);
      setNextBefore(page.data.nextBefore);
      setState('ready');
    } catch (err) {
      const status = err.response?.status;
      setState(status === 403 ? 'denied' : status === 404 ? 'notfound' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token, filter, allowed]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await axios.get(url, { headers, params: { limit: 50, before: nextBefore, ...(filter && { types: filter }) } });
      setEvents((current) => [...current, ...page.data.events]);
      setNextBefore(page.data.nextBefore);
    } catch {
      setState('error');
    } finally {
      setLoadingMore(false);
    }
  };

  const { summary } = useClinicalSummary(id, allowed && Boolean(patient));

  let lastMonth = null;

  return (
    <Layout>
      <div className="page-shell max-w-4xl">
        <PatientHeader
          patient={patient}
          loading={state === 'loading' && !patient}
          summary={summary}
          crumb="Timeline"
        />

        <header className="page-header">
          <div>
            <h2 className="page-title">Timeline</h2>
            <p className="text-slate-500 font-medium mt-1">Everything in order, newest first</p>
          </div>
        </header>

        {state === 'denied' && <EmptyState icon={Lock} title="Clinical data is not available to your role" />}
        {state === 'notfound' && <EmptyState title="Patient not found" />}
        {state === 'error' && <LoadError message="We couldn't load the timeline." onRetry={load} />}

        {(state === 'ready' || (state === 'loading' && patient)) && (
          <>
            <div className="flex flex-wrap gap-2 mb-6" role="tablist" aria-label="Filter">
              {FILTERS.map((f) => (
                <button key={f.key || 'all'} role="tab" aria-selected={f.key === filter} onClick={() => setFilter(f.key)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${f.key === filter ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {f.label}
                </button>
              ))}
            </div>

            {events.length === 0 ? (
              <EmptyState title="Nothing recorded yet" />
            ) : (
              <ol className="relative border-l-2 border-slate-100 ml-4 space-y-5">
                {events.map((event) => {
                  const [Icon, tone] = ICON[event.type];
                  const month = monthOf(event.at);
                  const heading = month !== lastMonth;
                  lastMonth = month;
                  return (
                    <li key={`${event.type}-${event.id}`} className="pl-8 relative">
                      {heading && <p className="-ml-8 mb-3 pl-8 text-[11px] font-black uppercase tracking-widest text-slate-400">{month}</p>}
                      <span className={`absolute -left-[17px] ${heading ? 'top-8' : 'top-1'} w-8 h-8 rounded-full flex items-center justify-center ring-4 ring-[#f8fafc] ${tone}`}><Icon size={15} /></span>
                      <div className="bg-white rounded-2xl border border-slate-100 p-4">
                        <p className="text-[11px] font-bold text-slate-400 mb-1">{formatDateTime(event.at)}</p>
                        <Event event={event} patientId={id} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {nextBefore && (
              <div className="mt-8 text-center">
                <button onClick={loadMore} disabled={loadingMore} className="px-6 py-3 rounded-xl border border-slate-200 text-sm font-bold text-secondary hover:border-primary hover:text-primary disabled:opacity-60">
                  {loadingMore ? 'Loading...' : 'Show older'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
};

export default PatientTimeline;
