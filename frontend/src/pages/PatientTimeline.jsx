import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import Layout from '../components/Layout';
import LoadError from '../components/LoadError';
import PatientHeader from '../components/PatientHeader';
import useClinicalSummary from '../utils/useClinicalSummary';
import { canViewClinical } from '../utils/clinicalAccess';
import TimelineEvents from '../components/TimelineEvents';
import { EmptyState, Skeleton } from '../components/ui';
import { Lock } from 'lucide-react';

const FILTERS = [
  { key: '', label: 'Everything' },
  { key: 'appointment', label: 'Visits' },
  { key: 'note,addendum', label: 'Notes' },
  { key: 'vitals', label: 'Vital signs' },
  { key: 'consent', label: 'Consent' }
];

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

        {state === 'loading' && !patient && (
          <div aria-busy="true" className="space-y-4">
            <span className="sr-only">Loading...</span>
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
          </div>
        )}
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

            {state === 'loading' ? (
              <div aria-busy="true" className="space-y-4">
                <span className="sr-only">Loading...</span>
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
              </div>
            ) : events.length === 0 ? (
              <EmptyState title="Nothing recorded yet" />
            ) : (
              <TimelineEvents events={events} patientId={id} />
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
