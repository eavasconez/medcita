import React, { useState, useEffect, useContext, useRef } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { diagnosisLabel, CERTAINTY_LABEL } from '../utils/consultationNote';
import { Search, X, Star } from 'lucide-react';

const SEARCH_DELAY_MS = 300;

// The diagnoses of a consultation note: picked from the ICD-10 list by code or by name, or typed
// as free text when they are not in it. A draft's author edits them; once the note is closed they
// are read-only. `onChange` receives the new list; the text of the note is not touched.
const NoteDiagnoses = ({ patientId, noteId, diagnoses, editable, onChange, onError }) => {
  const { token } = useContext(AuthContext);
  const headers = { Authorization: `Bearer ${token}` };
  const base = `${API_BASE_URL}/api/patients/${patientId}/clinical/notes/${noteId}/diagnoses`;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null: nothing searched yet
  const [catalogLoaded, setCatalogLoaded] = useState(true);
  const timer = useRef(null);
  // Number of the latest search: an answer that arrives after a newer search, or after a diagnosis
  // was added, is stale and is dropped (it would bring the list back for a field already cleared)
  const searchId = useRef(0);

  useEffect(() => {
    if (!editable) return;
    axios.get(`${API_BASE_URL}/api/diagnoses/status`, { headers }).then((res) => setCatalogLoaded(res.data.loaded > 0)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, token]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const type = (value) => {
    setQuery(value);
    clearTimeout(timer.current);
    searchId.current += 1;
    if (value.trim().length < 2) {
      setResults(null);
      return;
    }
    const mine = searchId.current;
    timer.current = setTimeout(async () => {
      let found;
      try {
        found = (await axios.get(`${API_BASE_URL}/api/diagnoses/search`, { params: { q: value.trim() }, headers })).data;
      } catch {
        found = [];
      }
      if (mine === searchId.current) setResults(found);
    }, SEARCH_DELAY_MS);
  };

  const add = async (body) => {
    try {
      const hasMain = diagnoses.some((d) => d.kind === 'primary');
      const res = await axios.post(base, { kind: hasMain ? 'secondary' : 'primary', ...body }, { headers });
      onChange([...diagnoses.map((d) => (res.data.kind === 'primary' ? { ...d, kind: 'secondary' } : d)), res.data]);
      clearTimeout(timer.current);
      searchId.current += 1;
      setQuery('');
      setResults(null);
    } catch (err) {
      onError(err.response?.data?.error || 'We couldn\'t add the diagnosis');
    }
  };

  const update = async (diagnosis, changes) => {
    try {
      const res = await axios.put(`${base}/${diagnosis.id}`, changes, { headers });
      onChange(diagnoses.map((d) => (d.id === diagnosis.id ? res.data : changes.kind === 'primary' && d.kind === 'primary' ? { ...d, kind: 'secondary' } : d)));
    } catch (err) {
      onError(err.response?.data?.error || 'We couldn\'t change the diagnosis');
    }
  };

  const remove = async (diagnosis) => {
    try {
      await axios.delete(`${base}/${diagnosis.id}`, { headers });
      onChange(diagnoses.filter((d) => d.id !== diagnosis.id));
    } catch (err) {
      onError(err.response?.data?.error || 'We couldn\'t remove the diagnosis');
    }
  };

  // the main one first
  const ordered = [...diagnoses].sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary'));
  const alreadyIn = (code) => diagnoses.some((d) => d.code === code);

  return (
    <section className="bg-white rounded-3xl border border-slate-100 p-6">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-8 h-8 rounded-xl bg-primary/10 text-primary font-black flex items-center justify-center text-xs">Dx</span>
        <h3 className="text-sm font-black text-secondary uppercase tracking-widest">Diagnoses</h3>
      </div>
      <p className="text-xs text-slate-400 font-medium mb-4 ml-11">ICD-10 code and name; the first one marked as main is what the visit is about</p>

      {ordered.length === 0 ? (
        <p className="text-sm font-medium text-slate-300 mb-4">No diagnoses recorded</p>
      ) : (
        <ul className="divide-y divide-slate-50 mb-4">
          {ordered.map((d) => (
            <li key={d.id} className="py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              {d.code ? (
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-secondary text-xs font-black tracking-wide">{d.code}</span>
              ) : (
                <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-widest">Free text</span>
              )}
              <span className="font-bold text-secondary flex-1 min-w-48 break-words">{diagnosisLabel(d.name)}</span>
              {d.kind === 'primary' && <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest"><Star size={11} /> Main</span>}
              {editable ? (
                <>
                  <select
                    aria-label={`Certainty of ${diagnosisLabel(d.name)}`}
                    className="form-input text-xs py-1.5 w-36"
                    value={d.certainty}
                    onChange={(e) => update(d, { certainty: e.target.value })}
                  >
                    {Object.entries(CERTAINTY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {d.kind !== 'primary' && (
                    <button onClick={() => update(d, { kind: 'primary' })} className="text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">Make main</button>
                  )}
                  <button onClick={() => remove(d)} aria-label={`Remove ${diagnosisLabel(d.name)}`} className="p-2 text-red-500 hover:bg-red-50 rounded-xl"><X size={16} /></button>
                </>
              ) : (
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{CERTAINTY_LABEL[d.certainty]}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="relative">
          <label htmlFor="dx-search" className="form-label">Add a diagnosis</label>
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="dx-search"
              className="form-input text-sm pl-10"
              placeholder="Search by code or name: E11, diabetes mellitus..."
              value={query}
              onChange={(e) => type(e.target.value)}
              autoComplete="off"
            />
          </div>

          {!catalogLoaded && (
            <p className="mt-2 text-xs font-semibold text-amber-700">The ICD-10 list has not been loaded in this installation yet. You can write the diagnosis as free text.</p>
          )}

          {results && query.trim().length >= 2 && (
            <ul role="listbox" aria-label="Diagnosis results" className="mt-2 rounded-2xl border border-slate-100 overflow-hidden divide-y divide-slate-50 max-h-72 overflow-y-auto shadow-lg shadow-slate-200/50">
              {results.map((r) => (
                <li key={r.code}>
                  <button
                    type="button"
                    disabled={alreadyIn(r.code)}
                    onClick={() => add({ code: r.code })}
                    className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-primary/5 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-secondary text-xs font-black">{r.code}</span>
                    <span className="text-sm font-semibold text-secondary">{diagnosisLabel(r.name)}</span>
                    {alreadyIn(r.code) && <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-slate-400">Added</span>}
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-4 py-3 text-sm font-medium text-slate-400">No diagnosis in the list matches "{query.trim()}"</li>}
            </ul>
          )}

          {query.trim().length >= 2 && (
            <button type="button" onClick={() => add({ name: query.trim() })} className="mt-3 text-xs font-black text-primary hover:underline">
              Add "{query.trim()}" as free text
            </button>
          )}
        </div>
      )}
    </section>
  );
};

export default NoteDiagnoses;
