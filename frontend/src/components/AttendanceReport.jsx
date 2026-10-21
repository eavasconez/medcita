import React, { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import LoadError from './LoadError';
import { UserX } from 'lucide-react';

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// The number MedCita exists to lower: of the visits that were closed in a month, how
// many the patient missed. Next to it, how many appointments were confirmed against
// those still waiting for an answer, and the patients who miss the most.
const AttendanceReport = () => {
  const { token } = useContext(AuthContext);
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const res = await axios.get(`${API_BASE_URL}/api/appointments/attendance`, {
        params: { month },
        headers: { Authorization: `Bearer ${token}` }
      });
      setData(res.data);
    } catch {
      setLoadError(true);
    }
  }, [token, month]);

  useEffect(() => {
    load();
  }, [load]);

  const answered = data ? data.confirmed + data.notConfirmed : 0;

  return (
    <div className="bg-white p-6 sm:p-10 rounded-[3rem] shadow-2xl border border-slate-100">
      <div className="flex flex-wrap items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-500">
          <UserX size={24} />
        </div>
        <div className="mr-auto">
          <h4 className="text-xl font-black text-secondary">No-shows</h4>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-0.5">Patients who did not come</p>
        </div>
        <input
          type="month"
          value={month}
          max={currentMonth()}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          aria-label="Month"
          className="p-3 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm text-secondary outline-none focus:ring-4 focus:ring-primary/10"
        />
      </div>

      {loadError ? (
        <LoadError message="We couldn't load the attendance numbers." onRetry={load} />
      ) : !data ? null : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div>
            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-1">No-show rate</p>
            <h3 className="text-5xl font-black text-secondary">{data.noShowRate === null ? '—' : `${data.noShowRate}%`}</h3>
            <p className="text-sm font-medium text-slate-400 mt-2">
              {data.noShow} missed of {data.attended + data.noShow} closed {data.attended + data.noShow === 1 ? 'visit' : 'visits'}
            </p>
          </div>

          <div>
            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-3">Confirmed vs not confirmed</p>
            {answered === 0 ? (
              <p className="text-sm font-medium text-slate-400">Nothing waiting to be confirmed.</p>
            ) : (
              <>
                <div className="flex h-4 rounded-full overflow-hidden bg-slate-100" role="img" aria-label={`${data.confirmed} confirmed, ${data.notConfirmed} not confirmed`}>
                  <div style={{ width: `${(data.confirmed / answered) * 100}%`, backgroundColor: '#10b981' }}></div>
                  <div style={{ width: `${(data.notConfirmed / answered) * 100}%`, backgroundColor: '#f59e0b' }}></div>
                </div>
                <div className="flex justify-between text-xs font-bold mt-3">
                  <span className="text-[#10b981]">{data.confirmed} confirmed</span>
                  <span className="text-[#f59e0b]">{data.notConfirmed} not confirmed</span>
                </div>
              </>
            )}
          </div>

          <div>
            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-3">Patients with most no-shows</p>
            {data.noShowByPatient.length === 0 ? (
              <p className="text-sm font-medium text-slate-400">No patient has missed a visit.</p>
            ) : (
              <ul className="space-y-2">
                {data.noShowByPatient.slice(0, 5).map((row) => (
                  <li key={row.patientId} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-secondary truncate">{row.name}</span>
                    <span className="ml-auto text-xs font-black text-red-400">{row.noShows}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceReport;
