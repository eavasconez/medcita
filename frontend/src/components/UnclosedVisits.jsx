import React, { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { ClipboardCheck } from 'lucide-react';

// Past appointments nobody has closed yet. Each one is closed with one click, either as
// completed or as a no-show, which is what feeds the attendance numbers; without this
// list the history fills with visits whose outcome nobody knows. `refreshKey` reloads
// it after the calendar changes, `onChange` tells the page to reload its own numbers.
const UnclosedVisits = ({ doctorId, refreshKey, onChange }) => {
  const { token } = useContext(AuthContext);
  const [list, setList] = useState({ total: 0, appointments: [] });
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    axios
      .get(`${API_BASE_URL}/api/appointments/unclosed`, {
        params: doctorId ? { doctorId } : {},
        headers: { Authorization: `Bearer ${token}` }
      })
      .then((res) => setList(res.data))
      .catch(() => {}); // a reminder to close visits, not a feature: stay quiet if it fails
  }, [token, doctorId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const close = async (id, status) => {
    setBusyId(id);
    try {
      await axios.put(`${API_BASE_URL}/api/appointments/${id}`, { status }, { headers: { Authorization: `Bearer ${token}` } });
      load();
      onChange?.();
    } catch {
      /* the row stays; the next reload shows the real state */
    } finally {
      setBusyId(null);
    }
  };

  if (list.total === 0) return null;

  return (
    <section className="mb-8 p-5 bg-amber-50 border border-amber-100 rounded-3xl" aria-label="Visits to close">
      <div className="flex items-start gap-4">
        <ClipboardCheck className="text-amber-500 shrink-0 mt-0.5" size={24} />
        <div className="min-w-0 flex-1">
          <p className="font-black text-amber-700">
            {list.total} past {list.total === 1 ? 'appointment is' : 'appointments are'} still open
          </p>
          <p className="text-sm font-medium text-amber-600 mt-1">Mark whether the patient was seen, so your attendance numbers are right.</p>
          <ul className="mt-4 space-y-2">
            {list.appointments.slice(0, 5).map((apt) => (
              <li key={apt.id} className="flex flex-wrap items-center gap-3 bg-white/70 rounded-2xl px-4 py-3">
                <span className="font-bold text-sm text-secondary truncate">{apt.Patient?.name}</span>
                <span className="text-xs font-bold text-slate-400">{apt.date} · {apt.time}</span>
                <span className="ml-auto flex gap-2">
                  <button
                    disabled={busyId === apt.id}
                    onClick={() => close(apt.id, 'completed')}
                    className="px-3 py-2 bg-[#10b981] text-white font-black rounded-xl text-[11px] uppercase tracking-widest disabled:opacity-50"
                  >
                    Seen
                  </button>
                  <button
                    disabled={busyId === apt.id}
                    onClick={() => close(apt.id, 'no_show')}
                    className="px-3 py-2 border-2 border-red-100 text-red-400 font-black rounded-xl text-[11px] uppercase tracking-widest disabled:opacity-50"
                  >
                    No-show
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {list.total > 5 && <p className="text-xs font-bold text-amber-500 mt-3">And {list.total - 5} more once these are closed.</p>}
        </div>
      </div>
    </section>
  );
};

export default UnclosedVisits;
