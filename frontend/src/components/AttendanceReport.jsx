import React, { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import format from 'date-fns/format';
import subDays from 'date-fns/subDays';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';
import subMonths from 'date-fns/subMonths';
import startOfYear from 'date-fns/startOfYear';
import endOfYear from 'date-fns/endOfYear';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import LoadError from './LoadError';
import { UserX, Download } from 'lucide-react';

const day = (date) => format(date, 'yyyy-MM-dd');

// Ready-made periods; each returns { from, to } for "today". A month or a year runs to its last
// day, so what is booked later in it (and still waiting to be confirmed) is counted too.
const PRESETS = [
  { label: 'This month', range: (today) => ({ from: day(startOfMonth(today)), to: day(endOfMonth(today)) }) },
  { label: 'Last month', range: (today) => ({ from: day(startOfMonth(subMonths(today, 1))), to: day(endOfMonth(subMonths(today, 1))) }) },
  { label: 'Last 30 days', range: (today) => ({ from: day(subDays(today, 29)), to: day(today) }) },
  { label: 'This year', range: (today) => ({ from: day(startOfYear(today)), to: day(endOfYear(today)) }) }
];

const fieldClass = 'p-3 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm text-secondary outline-none focus:ring-4 focus:ring-primary/10';

// A table of attendance by doctor or by type of visit: how many were closed, how many missed,
// and the rate as a bar, so the worst stands out at a glance.
const BreakdownTable = ({ title, rows, nameOf }) => (
  <div>
    <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-3">{title}</p>
    {rows.length === 0 ? (
      <p className="text-sm font-medium text-slate-400">No appointments in this period.</p>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400">
            <th className="pb-2 pr-3 font-black">Name</th>
            <th className="pb-2 px-3 font-black text-right">Booked</th>
            <th className="pb-2 px-3 font-black text-right">Missed</th>
            <th className="pb-2 pl-4 font-black w-44">No-show rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.doctorId || row.typeId} className="border-t border-slate-50">
              <td className="py-2.5 pr-3 font-bold text-secondary">{nameOf(row)}</td>
              <td className="py-2.5 px-3 text-right font-bold text-slate-500">{row.total}</td>
              <td className="py-2.5 px-3 text-right font-black text-red-400">{row.noShow}</td>
              <td className="py-2.5 pl-4">
                {row.noShowRate === null ? (
                  <span className="text-slate-300 font-bold">—</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                      <div className="h-full rounded-full bg-red-400" style={{ width: `${row.noShowRate}%` }}></div>
                    </div>
                    <span className="font-black text-secondary w-12 text-right">{row.noShowRate}%</span>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

// The number MedCita exists to lower, for any period and doctor: of the visits that were closed,
// how many the patient missed; next to it who is waiting to be confirmed, how each doctor and each
// type of visit does, and the patients who miss the most. It can be taken to a meeting or a
// spreadsheet (CSV, counts only).
const AttendanceReport = () => {
  const { token } = useContext(AuthContext);
  const headers = { Authorization: `Bearer ${token}` };
  const [range, setRange] = useState(() => PRESETS[0].range(new Date()));
  const [doctorId, setDoctorId] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/api/admin/doctors`, { params: { role: 'doctor' }, headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setDoctors(res.data))
      .catch(() => {}); // only feeds the doctor filter
  }, [token]);

  const params = { from: range.from, to: range.to, ...(doctorId && { doctorId }) };

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const res = await axios.get(`${API_BASE_URL}/api/admin/reports/attendance`, {
        params: { from: range.from, to: range.to, ...(doctorId && { doctorId }) },
        headers: { Authorization: `Bearer ${token}` }
      });
      setData(res.data);
    } catch {
      setLoadError(true);
    }
  }, [token, range.from, range.to, doctorId]);

  useEffect(() => {
    if (range.from && range.to && range.from <= range.to) load();
  }, [load, range.from, range.to]);

  const exportCsv = async () => {
    setExporting(true);
    setExportError('');
    try {
      const res = await axios.get(`${API_BASE_URL}/api/admin/reports/attendance/export`, { params, headers, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance_${range.from}_${range.to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Could not export the report. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const totals = data?.totals;
  const waiting = totals ? totals.confirmed + totals.notConfirmed : 0;
  const closed = totals ? totals.attended + totals.noShow : 0;
  const invalidRange = !range.from || !range.to || range.from > range.to;

  return (
    <div className="bg-white p-6 sm:p-10 rounded-[3rem] shadow-2xl border border-slate-100">
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-500">
          <UserX size={24} />
        </div>
        <div className="mr-auto">
          <h4 className="text-xl font-black text-secondary">No-shows</h4>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-0.5">Patients who did not come</p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting || invalidRange}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-sm bg-secondary text-white hover:opacity-90 disabled:opacity-40 transition-all"
        >
          <Download size={16} /> {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-8">
        <div className="flex flex-wrap gap-2 mr-2" role="group" aria-label="Period">
          {PRESETS.map((preset) => {
            const value = preset.range(new Date());
            const active = value.from === range.from && value.to === range.to;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setRange(value)}
                aria-pressed={active}
                className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all ${active ? 'bg-secondary text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <label className="block">
          <span className="form-label !mb-1">From</span>
          <input type="date" className={fieldClass} value={range.from} max={range.to || undefined} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </label>
        <label className="block">
          <span className="form-label !mb-1">To</span>
          <input type="date" className={fieldClass} value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </label>
        <label className="block">
          <span className="form-label !mb-1">Doctor</span>
          <select className={fieldClass} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">All doctors</option>
            {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
          </select>
        </label>
      </div>
      {exportError && <p role="alert" className="mb-6 text-sm font-bold text-red-500">{exportError}</p>}

      {loadError ? (
        <LoadError message="We couldn't load the attendance numbers." onRetry={load} />
      ) : !data ? null : (
        <div className="space-y-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div>
              <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-1">No-show rate</p>
              <h3 className="text-5xl font-black text-secondary">{totals.noShowRate === null ? '—' : `${totals.noShowRate}%`}</h3>
              <p className="text-sm font-medium text-slate-400 mt-2">
                {totals.noShow} missed of {closed} closed {closed === 1 ? 'visit' : 'visits'}
                {totals.cancelled > 0 && <> · {totals.cancelled} cancelled</>}
              </p>
            </div>

            <div>
              <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-3">Confirmed vs not confirmed</p>
              {waiting === 0 ? (
                <p className="text-sm font-medium text-slate-400">Nothing waiting to be confirmed.</p>
              ) : (
                <>
                  <div className="flex h-4 rounded-full overflow-hidden bg-slate-100" role="img" aria-label={`${totals.confirmed} confirmed, ${totals.notConfirmed} not confirmed`}>
                    <div style={{ width: `${(totals.confirmed / waiting) * 100}%`, backgroundColor: '#10b981' }}></div>
                    <div style={{ width: `${(totals.notConfirmed / waiting) * 100}%`, backgroundColor: '#f59e0b' }}></div>
                  </div>
                  <div className="flex justify-between text-xs font-bold mt-3">
                    <span className="text-[#10b981]">{totals.confirmed} confirmed</span>
                    <span className="text-[#f59e0b]">{totals.notConfirmed} not confirmed</span>
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

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-10">
            <BreakdownTable title="By doctor" rows={data.byDoctor} nameOf={(row) => row.name} />
            <BreakdownTable
              title="By type of visit"
              rows={data.byType}
              nameOf={(row) => (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: row.color || '#94a3b8' }}></span>
                  {row.name}
                </span>
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceReport;
