import React, { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import Layout from '../components/Layout';
import LoadError from '../components/LoadError';
import { ACTION_OPTIONS, ACTION_TONE, entryTitle, entryDetails, shortBrowser } from '../utils/auditText';
import { History, ChevronLeft, ChevronRight, X, MapPin } from 'lucide-react';

const PAGE_SIZE = 25;
const EMPTY_FILTERS = { from: '', to: '', actorId: '', action: '' };

// What happened in the clinic, newest first: sign-ins (and failed ones), password
// changes and what admins and secretaries did. Admins only; the server already
// limits it to their own clinic.
const AuditLog = () => {
  const { token, user } = useContext(AuthContext);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [people, setPeople] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/api/admin/doctors`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setPeople(res.data))
      .catch(() => {}); // only feeds the "person" filter
  }, [token]);

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const params = { page, pageSize: PAGE_SIZE };
      for (const [key, value] of Object.entries(filters)) if (value) params[key] = value;
      const res = await axios.get(`${API_BASE_URL}/api/admin/audit-log`, {
        headers: { Authorization: `Bearer ${token}` },
        params
      });
      setData(res.data);
    } catch (err) {
      console.error(err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token, filters, page]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const hasFilters = Object.values(filters).some(Boolean);
  const fieldClass = 'w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-secondary/10 focus:border-secondary font-bold text-secondary text-sm';

  return (
    <Layout>
      <div className="page-shell">
        <header className="page-header mb-8">
          <div>
            <h2 className="text-3xl sm:text-4xl font-black text-secondary tracking-tighter">Activity Log</h2>
            <p className="text-slate-500 font-medium text-base sm:text-lg mt-1">
              {user?.clinic?.name ? <>Who did what at <span className="font-black text-secondary">{user.clinic.name}</span></> : 'Who did what in your clinic'}
            </p>
          </div>
        </header>

        <section aria-label="Filters" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-8 items-end">
          <label className="block">
            <span className="form-label">From</span>
            <input type="date" className={fieldClass} value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
          </label>
          <label className="block">
            <span className="form-label">To</span>
            <input type="date" className={fieldClass} value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
          </label>
          <label className="block">
            <span className="form-label">Person</span>
            <select className={fieldClass} value={filters.actorId} onChange={(e) => setFilter('actorId', e.target.value)}>
              <option value="">Everyone</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name} ({person.role})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="form-label">Action</span>
            <select className={fieldClass} value={filters.action} onChange={(e) => setFilter('action', e.target.value)}>
              {ACTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={!hasFilters}
            onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-bold text-sm text-slate-500 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 transition-all"
          >
            <X size={16} /> Clear filters
          </button>
        </section>

        {loading && !data ? (
          <div className="text-center py-20 font-bold text-slate-400">Loading activity...</div>
        ) : loadError ? (
          <LoadError message="We couldn't load the activity log." onRetry={fetchEntries} />
        ) : data.entries.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200">
            <History className="mx-auto text-slate-300" size={40} />
            <p className="mt-3 font-black text-slate-400">No activity found</p>
            <p className="text-slate-300 text-sm">{hasFilters ? 'Try other filters.' : 'Sign-ins and changes will show up here.'}</p>
          </div>
        ) : (
          <>
            <ul className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {data.entries.map((entry) => {
                const details = entryDetails(entry);
                const browser = shortBrowser(entry.userAgent);
                return (
                  <li key={entry.id} className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm grid grid-cols-1 md:grid-cols-[10rem_1fr_17rem] gap-3 md:gap-6 md:items-center">
                    <time dateTime={entry.createdAt} className="text-sm font-bold text-slate-400">
                      {new Date(entry.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </time>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${ACTION_TONE[entry.action] || 'bg-slate-100 text-slate-600'}`}>
                          {entry.action.replace('_', ' ')}
                        </span>
                        <p className="font-black text-secondary">{entryTitle(entry)}</p>
                      </div>
                      {details.length > 0 && <p className="text-sm text-slate-500 font-medium mt-1 break-words">{details.join(' · ')}</p>}
                    </div>
                    <div className="min-w-0 text-sm">
                      <p className="font-black text-secondary truncate">{entry.actor.name}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{entry.actor.role}</p>
                      {(entry.ip || browser) && (
                        <p className="flex items-start gap-1 text-xs text-slate-400 font-medium mt-1 break-words" title={entry.userAgent || ''}>
                          <MapPin size={12} className="shrink-0 mt-0.5" /> <span>{[entry.ip, browser].filter(Boolean).join(' · ')}</span>
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <nav aria-label="Pagination" className="flex items-center justify-between mt-8">
              <p className="text-sm font-bold text-slate-400">{data.total} {data.total === 1 ? 'entry' : 'entries'} · page {data.page} of {Math.max(1, data.totalPages)}</p>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="flex items-center gap-1 px-4 py-2.5 rounded-2xl font-bold text-sm bg-white border border-slate-200 text-slate-500 hover:text-secondary disabled:opacity-40">
                  <ChevronLeft size={16} /> Newer
                </button>
                <button type="button" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="flex items-center gap-1 px-4 py-2.5 rounded-2xl font-bold text-sm bg-white border border-slate-200 text-slate-500 hover:text-secondary disabled:opacity-40">
                  Older <ChevronRight size={16} />
                </button>
              </div>
            </nav>
          </>
        )}
      </div>
    </Layout>
  );
};

export default AuditLog;
