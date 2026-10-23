import React, { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { CalendarOff, Plus, Trash2, Flag, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

const field = 'w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-primary font-bold text-secondary text-sm';
const dayLabel = (date) => format(parseISO(date), 'MMM d, yyyy');
const rangeLabel = (block) => (block.startDate === block.endDate ? dayLabel(block.startDate) : `${dayLabel(block.startDate)} – ${dayLabel(block.endDate)}`);
const todayString = () => format(new Date(), 'yyyy-MM-dd');

// What was already booked on the days that were just blocked. Nothing is cancelled for them:
// the person moves each one (drag it in the schedule, or open it and cancel it).
const AffectedAppointments = ({ total, appointments, onClose }) => (
  <div role="alert" className="p-5 bg-amber-50 border border-amber-200 rounded-2xl">
    <div className="flex items-start gap-3">
      <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={22} />
      <div className="flex-1 min-w-0">
        <p className="font-black text-secondary">
          {total} {total === 1 ? 'appointment is' : 'appointments are'} already booked on these days
        </p>
        <p className="text-slate-500 text-sm font-medium mt-1">They were not cancelled. Reschedule each one from your schedule (drag it to a free day) or cancel it.</p>
        <ul className="mt-3 space-y-1.5">
          {appointments.map((apt) => (
            <li key={apt.id} className="text-sm font-bold text-secondary flex flex-wrap gap-x-3">
              <span>{dayLabel(apt.date)} · {apt.time}</span>
              <span>{apt.patient.name}</span>
              <span className="text-slate-400">{apt.doctor.name}</span>
            </li>
          ))}
          {total > appointments.length && <li className="text-sm text-slate-400 font-bold">…and {total - appointments.length} more</li>}
        </ul>
      </div>
      {onClose && <button type="button" onClick={onClose} className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-secondary">Dismiss</button>}
    </div>
  </div>
);

// Days nobody attends: a doctor's vacation, a congress, a holiday of the whole clinic. Nobody can
// book them; what is already booked there stays and is listed to be rescheduled.
const ScheduleBlocksSection = ({ doctors, isStaff, selectedDoctorId, showToast }) => {
  const { token } = useContext(AuthContext);
  const headers = { Authorization: `Bearer ${token}` };
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const emptyForm = { scope: 'doctor', doctorId: '', startDate: '', endDate: '', reason: '' };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [affected, setAffected] = useState(null);
  const [openBlockId, setOpenBlockId] = useState(null);
  const [openBlock, setOpenBlock] = useState(null);
  const [holidays, setHolidays] = useState(null); // null = panel closed
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/schedule-blocks`, { params: { from: todayString() }, headers: { Authorization: `Bearer ${token}` } });
      setBlocks(res.data);
    } catch (err) {
      console.error(err);
      showToast('Could not load the time off', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const doctorForForm = form.doctorId || selectedDoctorId || doctors[0]?.id || '';
  // A clinic with no doctor yet has only "The whole clinic" to choose, and the list shows it: that is what is sent
  const scope = isStaff && form.scope === 'doctor' && !doctorForForm ? 'clinic' : form.scope;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { scope, startDate: form.startDate, endDate: form.endDate || form.startDate, reason: form.reason };
      if (scope === 'doctor' && isStaff) body.doctorId = doctorForForm;
      const res = await axios.post(`${API_BASE_URL}/api/schedule-blocks`, body, { headers });
      setForm(emptyForm);
      setAffected(res.data.affectedTotal > 0 ? { total: res.data.affectedTotal, appointments: res.data.affectedAppointments } : null);
      showToast('Days blocked: nobody can book them now');
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not block those days', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (block) => {
    if (!window.confirm(`Open ${rangeLabel(block)} again for booking?`)) return;
    try {
      await axios.delete(`${API_BASE_URL}/api/schedule-blocks/${block.id}`, { headers });
      showToast('Those days are open again');
      if (openBlockId === block.id) setOpenBlockId(null);
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not remove the block', 'error');
    }
  };

  const toggleAppointments = async (block) => {
    if (openBlockId === block.id) return setOpenBlockId(null);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/schedule-blocks/${block.id}/appointments`, { headers });
      setOpenBlock({ total: res.data.affectedTotal, appointments: res.data.affectedAppointments });
      setOpenBlockId(block.id);
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not load the appointments', 'error');
    }
  };

  const openHolidays = async (year) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/schedule-blocks/holidays`, { params: { year }, headers });
      setHolidayYear(year);
      const today = todayString();
      setHolidays(res.data.holidays.map((h) => ({ ...h, selected: h.date >= today })));
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not load the holidays', 'error');
    }
  };

  const updateHoliday = (index, patch) => setHolidays((list) => list.map((h, i) => (i === index ? { ...h, ...patch } : h)));

  const saveHolidays = async () => {
    setSaving(true);
    const chosen = holidays.filter((h) => h.selected);
    let created = 0;
    const appointments = [];
    let total = 0;
    const failures = [];
    for (const holiday of chosen) {
      try {
        const res = await axios.post(`${API_BASE_URL}/api/schedule-blocks`, { scope: 'clinic', startDate: holiday.date, reason: holiday.name }, { headers });
        created += 1;
        total += res.data.affectedTotal;
        appointments.push(...res.data.affectedAppointments);
      } catch (err) {
        failures.push(`${holiday.name}: ${err.response?.data?.error || 'failed'}`);
      }
    }
    setSaving(false);
    if (created > 0) {
      setHolidays(null);
      appointments.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
      setAffected(total > 0 ? { total, appointments: appointments.slice(0, 200) } : null);
      showToast(`${created} ${created === 1 ? 'holiday' : 'holidays'} blocked${failures.length ? `; ${failures.length} failed` : ''}`, failures.length ? 'error' : 'success');
      await load();
    } else {
      showToast(failures[0] || 'Choose at least one holiday', 'error');
    }
  };

  return (
    <section className="mt-10 bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm" aria-label="Time off">
      <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center text-orange-500">
            <CalendarOff size={20} />
          </div>
          <div>
            <p className="font-bold text-secondary">Time off</p>
            <p className="text-slate-400 text-xs font-bold">Vacations, congresses and holidays: nobody can book those days</p>
          </div>
        </div>
        {isStaff && (
          <button type="button" onClick={() => (holidays ? setHolidays(null) : openHolidays(holidayYear))} className="text-primary hover:bg-primary/5 px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-1">
            <Flag size={16} /> Ecuador holidays
          </button>
        )}
      </div>

      <div className="p-6 space-y-6">
        {affected && <AffectedAppointments total={affected.total} appointments={affected.appointments} onClose={() => setAffected(null)} />}

        {isStaff && holidays && (
          <div className="p-5 bg-slate-50 border border-slate-100 rounded-2xl space-y-3" aria-label="Ecuador holidays">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-black text-secondary">Block the whole clinic on these holidays</p>
              <select aria-label="Year" className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 font-bold text-secondary text-sm" value={holidayYear} onChange={(e) => openHolidays(Number(e.target.value))}>
                {[new Date().getFullYear(), new Date().getFullYear() + 1].map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            <p className="text-slate-500 text-xs font-bold">A starting point, not the official calendar: the Ministerio del Trabajo can move some holidays to a Monday, and local holidays are not included. Fix the dates before saving.</p>
            <ul className="space-y-2">
              {holidays.map((holiday, index) => (
                <li key={`${holiday.name}-${holiday.date}`} className="flex flex-wrap items-center gap-3">
                  <input type="checkbox" aria-label={`Block ${holiday.name}`} checked={holiday.selected} onChange={(e) => updateHoliday(index, { selected: e.target.checked })} />
                  <input type="date" aria-label={`Date of ${holiday.name}`} className={`${field} !w-44`} value={holiday.date} onChange={(e) => updateHoliday(index, { date: e.target.value })} />
                  <input type="text" aria-label={`Reason for ${holiday.name}`} className={`${field} flex-1 min-w-[10rem]`} maxLength={120} value={holiday.name} onChange={(e) => updateHoliday(index, { name: e.target.value })} />
                  {holiday.note && <span className="text-[11px] text-amber-600 font-bold w-full sm:w-auto">{holiday.note}</span>}
                </li>
              ))}
            </ul>
            <button type="button" disabled={saving} onClick={saveHolidays} className="btn-primary px-6 py-2.5 rounded-xl text-sm disabled:opacity-50">
              {saving ? 'Saving...' : 'Block the selected holidays'}
            </button>
          </div>
        )}

        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end" aria-label="Block days">
          {isStaff && (
            <label className="block sm:col-span-2">
              <span className="form-label !mb-1">Who</span>
              <select className={field} value={scope === 'clinic' ? 'clinic' : doctorForForm} onChange={(e) => setForm(e.target.value === 'clinic' ? { ...form, scope: 'clinic' } : { ...form, scope: 'doctor', doctorId: e.target.value })}>
                <option value="clinic">The whole clinic</option>
                {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
              </select>
            </label>
          )}
          <label className="block sm:col-span-2">
            <span className="form-label !mb-1">From</span>
            <input type="date" required className={field} min={todayString()} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </label>
          <label className="block sm:col-span-2">
            <span className="form-label !mb-1">Until (optional)</span>
            <input type="date" className={field} min={form.startDate || todayString()} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </label>
          <label className={`block ${isStaff ? 'sm:col-span-4' : 'sm:col-span-4'}`}>
            <span className="form-label !mb-1">Reason</span>
            <input type="text" required minLength={2} maxLength={120} className={field} placeholder="e.g. Vacations" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={saving} className="btn-primary w-full px-6 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              <Plus size={16} /> {saving ? 'Saving...' : 'Block these days'}
            </button>
          </div>
        </form>

        {loading ? (
          <p className="text-slate-400 font-bold text-sm">Loading...</p>
        ) : blocks.length === 0 ? (
          <p className="text-center py-6 text-slate-400 font-medium italic">No time off coming up.</p>
        ) : (
          <ul className="space-y-3">
            {blocks.map((block) => (
              <li key={block.id} className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[12rem]">
                    <p className="font-black text-secondary">{rangeLabel(block)}</p>
                    <p className="text-slate-500 text-sm font-medium">{block.reason}</p>
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${block.scope === 'clinic' ? 'bg-orange-100 text-orange-600' : 'bg-primary/10 text-primary'}`}>
                    {block.scope === 'clinic' ? 'Whole clinic' : block.doctorName}
                  </span>
                  <button type="button" onClick={() => toggleAppointments(block)} className="text-xs font-black text-slate-400 hover:text-secondary flex items-center gap-1">
                    Appointments {openBlockId === block.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {(isStaff || block.scope === 'doctor') && (
                    <button type="button" onClick={() => remove(block)} aria-label={`Remove ${block.reason}`} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all">
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
                {openBlockId === block.id && openBlock && (
                  <div className="mt-3">
                    {openBlock.total === 0
                      ? <p className="text-sm text-emerald-600 font-bold">No appointments are booked on these days.</p>
                      : <AffectedAppointments total={openBlock.total} appointments={openBlock.appointments} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default ScheduleBlocksSection;
