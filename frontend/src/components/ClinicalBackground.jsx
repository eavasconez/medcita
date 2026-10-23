import React, { useState, useContext } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { SEVERITY_LABEL } from '../utils/patientRecord';
import { Plus, Edit, Trash2, Check } from 'lucide-react';

const CATEGORY_LABEL = { personal: 'Personal', family: 'Family', surgical: 'Surgical', habit: 'Habits' };

// What each list asks for. `line` is how a saved entry reads.
const KINDS = {
  allergies: {
    title: 'Allergies',
    empty: 'No allergies recorded',
    stopLabel: ['Resolved', 'Reactivate'],
    fields: [
      { name: 'substance', label: 'Substance', required: true, placeholder: 'Ex: Penicillin' },
      { name: 'reaction', label: 'Reaction', placeholder: 'Ex: Hives' },
      { name: 'severity', label: 'Severity', options: SEVERITY_LABEL }
    ],
    blank: { substance: '', reaction: '', severity: '' },
    line: (r) => ({ main: r.substance, detail: [r.reaction, r.severity && SEVERITY_LABEL[r.severity]].filter(Boolean).join(' · ') })
  },
  medications: {
    title: 'Regular medication',
    empty: 'No regular medication recorded',
    stopLabel: ['Stopped', 'Resume'],
    fields: [
      { name: 'name', label: 'Medicine', required: true, placeholder: 'Ex: Metformin' },
      { name: 'dose', label: 'Dose', placeholder: 'Ex: 850 mg' },
      { name: 'frequency', label: 'Frequency', placeholder: 'Ex: every 12 hours' }
    ],
    blank: { name: '', dose: '', frequency: '' },
    line: (r) => ({ main: r.name, detail: [r.dose, r.frequency].filter(Boolean).join(' · ') })
  },
  backgrounds: {
    title: 'History',
    empty: 'No history recorded',
    fields: [
      { name: 'category', label: 'Type', required: true, options: CATEGORY_LABEL },
      { name: 'description', label: 'Description', required: true, placeholder: 'Ex: Appendectomy' },
      { name: 'noted', label: 'When', placeholder: 'Ex: 2019, since childhood' }
    ],
    blank: { category: 'personal', description: '', noted: '' },
    line: (r) => ({ main: r.description, detail: r.noted || '' })
  }
};

// The allergies, regular medication and history of one patient: add, edit, mark as resolved
// or stopped (kept in the history) and delete what was written by mistake.
const ClinicalBackground = ({ patientId, summary, onChange, onError }) => {
  const { token } = useContext(AuthContext);
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState(null); // { kind, id?, values }
  const [saving, setSaving] = useState(false);

  const base = `${API_BASE_URL}/api/patients/${patientId}/clinical`;

  const run = async (request, fallback) => {
    try {
      await request();
      await onChange();
      return true;
    } catch (err) {
      onError(err.response?.data?.error || fallback);
      return false;
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { kind, id, values } = form;
    const ok = await run(
      () => (id ? axios.put(`${base}/${kind}/${id}`, values, { headers }) : axios.post(`${base}/${kind}`, values, { headers })),
      'We couldn\'t save the entry'
    );
    setSaving(false);
    if (ok) setForm(null);
  };

  const remove = (kind, row) => {
    if (!window.confirm('Delete this entry? Use it only for something written by mistake.')) return;
    run(() => axios.delete(`${base}/${kind}/${row.id}`, { headers }), 'We couldn\'t delete the entry');
  };

  const toggle = (kind, row) => run(() => axios.put(`${base}/${kind}/${row.id}`, { active: !row.active }, { headers }), 'We couldn\'t update the entry');

  const edit = (kind, row) =>
    setForm({ kind, id: row.id, values: Object.fromEntries(KINDS[kind].fields.map((f) => [f.name, row[f.name] || ''])) });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {Object.entries(KINDS).map(([kind, config]) => {
        const rows = summary[kind];
        const editing = form?.kind === kind;
        return (
          <section key={kind} className={`bg-white rounded-3xl border border-slate-100 p-6 ${kind === 'backgrounds' ? 'lg:col-span-2' : ''}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-secondary uppercase tracking-widest">{config.title}</h3>
              {!editing && (
                <button
                  onClick={() => setForm({ kind, values: { ...config.blank } })}
                  aria-label={`Add to ${config.title}`}
                  className="flex items-center gap-1 text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl"
                >
                  <Plus size={14} /> Add
                </button>
              )}
            </div>

            {editing && (
              <form onSubmit={save} className="mb-4 p-4 bg-slate-50 rounded-2xl grid grid-cols-1 sm:grid-cols-3 gap-3">
                {config.fields.map((f) => (
                  <div key={f.name} className={f.name === 'description' ? 'sm:col-span-3' : ''}>
                    <label className="form-label" htmlFor={`cb-${kind}-${f.name}`}>{f.label}</label>
                    {f.options ? (
                      <select
                        id={`cb-${kind}-${f.name}`}
                        required={f.required}
                        className="form-input text-sm"
                        value={form.values[f.name]}
                        onChange={(e) => setForm({ ...form, values: { ...form.values, [f.name]: e.target.value } })}
                      >
                        {!f.required && <option value="">Not specified</option>}
                        {Object.entries(f.options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    ) : (
                      <input
                        id={`cb-${kind}-${f.name}`}
                        required={f.required}
                        className="form-input text-sm"
                        placeholder={f.placeholder}
                        value={form.values[f.name]}
                        onChange={(e) => setForm({ ...form, values: { ...form.values, [f.name]: e.target.value } })}
                      />
                    )}
                  </div>
                ))}
                <div className="sm:col-span-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setForm(null)} className="px-4 py-2 text-slate-400 font-black rounded-xl hover:bg-white text-[10px] uppercase tracking-widest">Cancel</button>
                  <button type="submit" disabled={saving} className="px-5 py-2 bg-primary text-white font-black rounded-xl text-[10px] uppercase tracking-widest disabled:opacity-60">
                    {saving ? 'Saving...' : form.id ? 'Save' : 'Add'}
                  </button>
                </div>
              </form>
            )}

            {rows.length === 0 ? (
              <p className="text-sm font-medium text-slate-300">{config.empty}</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {rows.map((row) => {
                  const { main, detail } = config.line(row);
                  const inactive = row.active === false;
                  return (
                    <li key={row.id} className="py-3 flex items-start gap-3">
                      <div className={`flex-1 min-w-0 ${inactive ? 'opacity-50' : ''}`}>
                        {kind === 'backgrounds' && <span className="inline-block mr-2 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-widest">{CATEGORY_LABEL[row.category]}</span>}
                        <span className={`font-bold text-secondary break-words ${inactive ? 'line-through' : ''}`}>{main}</span>
                        {detail && <p className="text-sm text-slate-500 font-medium break-words">{detail}</p>}
                        {inactive && <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{config.stopLabel[0]}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {config.stopLabel && (
                          <button onClick={() => toggle(kind, row)} title={inactive ? config.stopLabel[1] : `Mark as ${config.stopLabel[0].toLowerCase()}`} aria-label={`${inactive ? config.stopLabel[1] : config.stopLabel[0]}: ${main}`} className="p-2 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-xl">
                            {inactive ? <Plus size={16} /> : <Check size={16} />}
                          </button>
                        )}
                        <button onClick={() => edit(kind, row)} aria-label={`Edit ${main}`} className="p-2 text-primary hover:bg-primary/5 rounded-xl"><Edit size={16} /></button>
                        <button onClick={() => remove(kind, row)} aria-label={`Delete ${main}`} className="p-2 text-red-500 hover:bg-red-50 rounded-xl"><Trash2 size={16} /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default ClinicalBackground;
