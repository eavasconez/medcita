import React, { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { X, ShieldCheck } from 'lucide-react';
import { METHOD_LABEL } from '../utils/consent';

const formatDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// The health-data consent of one patient: the text they are shown, how to record that they
// agreed (or took it back), and everything recorded so far. Events are never edited: a
// withdrawal is a new line.
const PatientConsentModal = ({ patient, onClose, onChange }) => {
  const { token } = useContext(AuthContext);
  const headers = { Authorization: `Bearer ${token}` };
  const [document, setDocument] = useState(null);
  const [state, setState] = useState(null);
  const [method, setMethod] = useState('in_person_signed');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [doc, consents] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/patients/consent-document`, { headers }),
        axios.get(`${API_BASE_URL}/api/patients/${patient.id}/consents`, { headers })
      ]);
      setDocument(doc.data);
      setState(consents.data);
    } catch {
      setError('We couldn\'t load the consent.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, token]);

  useEffect(() => {
    load();
  }, [load]);

  const record = async (granted) => {
    setSaving(true);
    setError('');
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/patients/${patient.id}/consents`,
        { granted, method, documentVersion: document.version },
        { headers }
      );
      setState(res.data);
      onChange?.();
    } catch (err) {
      setError(err.response?.data?.error || 'We couldn\'t record it.');
      if (err.response?.status === 409) load();
    } finally {
      setSaving(false);
    }
  };

  const standing = state && {
    none: ['No consent recorded yet', 'bg-amber-50 text-amber-700 border-amber-100'],
    granted: [state.upToDate ? 'Consent given' : 'Consent given to an older text', state.upToDate ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'],
    withdrawn: ['Consent withdrawn', 'bg-red-50 text-red-600 border-red-100']
  }[state.status];

  return (
    <div className="fixed inset-0 z-[150] overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 py-8">
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose}></div>
        <div role="dialog" aria-label="Health data consent" className="modal-panel relative rounded-[2.5rem] max-w-2xl w-full p-6 sm:p-10">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary shrink-0"><ShieldCheck size={24} /></div>
              <div className="min-w-0">
                <h3 className="text-2xl font-black text-secondary truncate">{patient.name}</h3>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Health data consent</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-50 rounded-xl"><X size={20} className="text-slate-400" /></button>
          </div>

          {error && <p role="alert" className="mb-4 p-3 bg-red-50 text-red-600 rounded-2xl text-sm font-bold">{error}</p>}
          {!state || !document ? (
            !error && <p className="text-slate-400 font-semibold">Loading…</p>
          ) : (
            <div className="space-y-6">
              <div className={`px-4 py-3 rounded-2xl border font-black text-sm ${standing[1]}`}>
                {standing[0]}
                {state.current && <span className="font-medium"> · {formatDate(state.current.createdAt)} · text {state.current.documentVersion}</span>}
              </div>

              <div className="max-h-56 overflow-y-auto p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3 text-sm text-slate-600">
                <p className="font-black text-secondary">{document.title} <span className="text-slate-400 font-bold">(text {document.version})</span></p>
                {document.paragraphs.map((paragraph, i) => (
                  <p key={i}>{paragraph.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part))}</p>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex-1 min-w-[12rem]">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">How the patient agreed</span>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="mt-1 w-full p-3 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm text-secondary outline-none"
                  >
                    {document.methods.map((value) => <option key={value} value={value}>{METHOD_LABEL[value] || value}</option>)}
                  </select>
                </label>
                <button
                  disabled={saving}
                  onClick={() => record(true)}
                  className="px-5 py-3 bg-[#10b981] text-white font-black rounded-2xl text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  {state.status === 'granted' && !state.upToDate ? 'Record consent to the new text' : 'Record consent'}
                </button>
                {state.status === 'granted' && (
                  <button
                    disabled={saving}
                    onClick={() => record(false)}
                    className="px-5 py-3 border-2 border-red-100 text-red-400 font-black rounded-2xl text-xs uppercase tracking-widest disabled:opacity-50"
                  >
                    Withdraw consent
                  </button>
                )}
              </div>

              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">History</p>
                {state.history.length === 0 ? (
                  <p className="text-sm font-medium text-slate-400">Nothing recorded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {state.history.map((event) => (
                      <li key={event.id} className="text-sm text-slate-600 flex flex-wrap gap-x-2">
                        <span className={`font-black ${event.granted ? 'text-emerald-600' : 'text-red-500'}`}>{event.granted ? 'Given' : 'Withdrawn'}</span>
                        <span>{formatDate(event.createdAt)}</span>
                        <span className="text-slate-400">· {METHOD_LABEL[event.method] || event.method} · text {event.documentVersion} · recorded by {event.recordedBy.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PatientConsentModal;
