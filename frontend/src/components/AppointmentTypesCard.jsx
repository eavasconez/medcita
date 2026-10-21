import React, { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { Stethoscope, Plus, Save, Archive, RotateCcw, Pencil, X } from 'lucide-react';

const MIN_DURATION = 5;
const MAX_DURATION = 240;
const STEP = 5;
const EMPTY_FORM = { name: '', durationMinutes: 30, color: '#0ea5e9' };

// The kinds of visit the clinic offers ("First visit, 40 min"): the length decides how much
// of the agenda a booking takes. Admins only. A type is archived, never deleted, so the
// appointments that have it keep it; the default type cannot be archived.
const AppointmentTypesCard = ({ onMessage }) => {
  const { token } = useContext(AuthContext);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // 'new' or a type id
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/appointment-types`, { params: { includeArchived: true }, headers: { Authorization: `Bearer ${token}` } });
      setTypes(res.data);
    } catch (err) {
      console.error(err);
      onMessage('Could not load the appointment types', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, onMessage]);

  useEffect(() => {
    load();
  }, [load]);

  const startEditing = (type) => {
    setEditingId(type ? type.id : 'new');
    setForm(type ? { name: type.name, durationMinutes: type.durationMinutes, color: type.color } : EMPTY_FORM);
  };
  const stopEditing = () => setEditingId(null);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = { name: form.name, durationMinutes: Number(form.durationMinutes), color: form.color };
    try {
      if (editingId === 'new') await axios.post(`${API_BASE_URL}/api/appointment-types`, body, { headers });
      else await axios.put(`${API_BASE_URL}/api/appointment-types/${editingId}`, body, { headers });
      onMessage(editingId === 'new' ? 'Appointment type added' : 'Appointment type updated');
      stopEditing();
      await load();
    } catch (err) {
      onMessage(err.response?.data?.error || 'Could not save the appointment type', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (type, active) => {
    try {
      await axios.put(`${API_BASE_URL}/api/appointment-types/${type.id}`, { active }, { headers });
      onMessage(active ? `${type.name} is offered again` : `${type.name} archived`);
      await load();
    } catch (err) {
      onMessage(err.response?.data?.error || 'Could not change the appointment type', 'error');
    }
  };

  const fieldClass = 'w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-secondary/10 focus:border-secondary font-bold text-secondary text-sm';

  const form_ = (
    <form onSubmit={save} className="p-5 bg-slate-50 border border-slate-100 rounded-2xl grid grid-cols-1 sm:grid-cols-[1fr_8rem_4rem] gap-3 items-end" aria-label={editingId === 'new' ? 'New appointment type' : 'Edit appointment type'}>
      <label className="block">
        <span className="form-label">Name</span>
        <input className={fieldClass} required minLength={2} maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. First visit" />
      </label>
      <label className="block">
        <span className="form-label">Minutes</span>
        <input className={fieldClass} type="number" required min={MIN_DURATION} max={MAX_DURATION} step={STEP} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
      </label>
      <label className="block">
        <span className="form-label">Color</span>
        <input className="w-full h-[46px] p-1 bg-white border border-slate-200 rounded-2xl cursor-pointer" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
      </label>
      <div className="sm:col-span-3 flex gap-3">
        <button type="submit" disabled={saving} className="btn-primary px-6 py-2.5 rounded-xl flex items-center gap-2 disabled:opacity-50">
          <Save size={16} /> {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={stopEditing} className="px-4 py-2.5 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-100 flex items-center gap-2">
          <X size={16} /> Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="card sm:p-10">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
          <Stethoscope size={24} />
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-black text-secondary uppercase tracking-tight">Appointment types</h3>
          <p className="text-slate-400 font-medium text-sm">How long each kind of visit lasts. Changing a length only affects the appointments booked from then on.</p>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-400 font-bold text-sm">Loading...</p>
      ) : (
        <ul className="space-y-3">
          {types.map((type) => (
            <li key={type.id}>
              {editingId === type.id ? form_ : (
                <div className={`flex items-center gap-4 p-4 rounded-2xl border border-slate-100 ${type.active ? 'bg-white' : 'bg-slate-50 opacity-70'}`}>
                  <span className="inline-block w-4 h-4 rounded-md shrink-0" style={{ backgroundColor: type.color }} aria-hidden="true"></span>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-secondary truncate">
                      {type.name}
                      {type.isDefault && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full">Default</span>}
                      {!type.active && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">Archived</span>}
                    </p>
                    <p className="text-slate-400 text-xs font-bold">{type.durationMinutes} minutes</p>
                  </div>
                  <button type="button" onClick={() => startEditing(type)} aria-label={`Edit ${type.name}`} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-secondary">
                    <Pencil size={16} />
                  </button>
                  {!type.isDefault && (type.active ? (
                    <button type="button" onClick={() => setActive(type, false)} aria-label={`Archive ${type.name}`} className="p-2 rounded-xl text-slate-400 hover:bg-orange-50 hover:text-orange-500">
                      <Archive size={16} />
                    </button>
                  ) : (
                    <button type="button" onClick={() => setActive(type, true)} aria-label={`Restore ${type.name}`} className="p-2 rounded-xl text-slate-400 hover:bg-emerald-50 hover:text-emerald-600">
                      <RotateCcw size={16} />
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
          <li>
            {editingId === 'new' ? form_ : (
              <button type="button" onClick={() => startEditing(null)} className="w-full p-4 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 font-black text-sm hover:border-primary hover:text-primary flex items-center justify-center gap-2 transition-all">
                <Plus size={16} /> Add an appointment type
              </button>
            )}
          </li>
        </ul>
      )}
    </div>
  );
};

export default AppointmentTypesCard;
