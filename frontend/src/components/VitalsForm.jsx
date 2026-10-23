import React, { useState, useContext } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { FIELDS, blankForm, toPayload, toLocalInput } from '../utils/vitals';

// A new set of measurements. Any of them may be left empty, but not all; blood pressure takes both
// numbers. `appointmentId` ties the reading to a visit. The server checks everything again.
const VitalsForm = ({ patientId, appointmentId = null, onSaved, onCancel }) => {
  const { token } = useContext(AuthContext);
  const [form, setForm] = useState(blankForm());
  const [measuredAt, setMeasuredAt] = useState(toLocalInput());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const payload = toPayload(form);
    if (Object.keys(payload).length === 0) {
      setError('Record at least one measurement');
      return;
    }
    setSaving(true);
    try {
      await axios.post(
        `${API_BASE_URL}/api/patients/${patientId}/clinical/vitals`,
        { ...payload, measuredAt: new Date(measuredAt).toISOString(), ...(appointmentId && { appointmentId }) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'We couldn\'t save the measurements');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-slate-50 rounded-2xl p-5 mb-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FIELDS.map((f) => (
          <div key={f.name}>
            <label htmlFor={`vit-${f.name}`} className="form-label">{f.label} <span className="text-slate-300 normal-case">({f.unit})</span></label>
            <input
              id={`vit-${f.name}`}
              type="number"
              inputMode="decimal"
              step={f.step}
              min={f.min}
              max={f.max}
              className="form-input text-sm"
              value={form[f.name]}
              onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
            />
          </div>
        ))}
        <div className="col-span-2">
          <label htmlFor="vit-measuredAt" className="form-label">Measured at</label>
          <input id="vit-measuredAt" type="datetime-local" required max={toLocalInput()} className="form-input text-sm" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="px-4 py-2 text-slate-400 font-black rounded-xl hover:bg-white text-[10px] uppercase tracking-widest">Cancel</button>}
        <button type="submit" disabled={saving} className="px-6 py-2 bg-primary text-white font-black rounded-xl text-[10px] uppercase tracking-widest disabled:opacity-60">{saving ? 'Saving...' : 'Save measurements'}</button>
      </div>
    </form>
  );
};

export default VitalsForm;
