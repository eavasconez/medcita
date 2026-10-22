import React, { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { BellRing, Save, MessageCircle, Mail } from 'lucide-react';

const fieldClass = 'w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-secondary/10 focus:border-secondary font-bold text-secondary text-sm';
const hoursLabel = (hours) => `${hours} hours before`;

const Toggle = ({ checked, onChange, label, icon, disabled }) => (
  <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${checked ? 'border-primary/40 bg-primary/5' : 'border-slate-100 bg-white'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
    <input type="checkbox" className="w-4 h-4 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    {icon}
    <span className="font-black text-secondary text-sm">{label}</span>
  </label>
);

// How the clinic reminds its patients: whether it does, how long before the appointment (and a
// second reminder), through which channels, and the details that go in the message. The text of
// the WhatsApp message is the template approved by Meta; only the details can change. Admins only.
const ReminderSettingsCard = ({ onMessage }) => {
  const { token } = useContext(AuthContext);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((data) => {
    setSettings(data);
    setForm({ enabled: data.enabled, hours: data.hours, secondHours: data.secondHours, whatsapp: data.whatsapp, email: data.email, address: data.address || '', indications: data.indications || '' });
  }, []);

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/api/admin/reminder-settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => apply(res.data))
      .catch(() => onMessage('Could not load the reminder settings', 'error'));
  }, [token, apply, onMessage]);

  if (!form) return null;

  const set = (patch) => {
    const next = { ...form, ...patch };
    // A second reminder has to be closer to the appointment than the first
    if (next.secondHours !== null && next.secondHours >= next.hours) next.secondHours = null;
    setForm(next);
  };
  const secondOptions = settings.options.hours.filter((hours) => hours < form.hours);
  const noChannel = form.enabled && !form.whatsapp && !form.email;
  const changed = ['enabled', 'hours', 'secondHours', 'whatsapp', 'email'].some((key) => form[key] !== settings[key])
    || form.address !== (settings.address || '') || form.indications !== (settings.indications || '');

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await axios.put(`${API_BASE_URL}/api/admin/reminder-settings`, form, { headers: { Authorization: `Bearer ${token}` } });
      apply(res.data);
      onMessage('Reminder settings saved');
    } catch (err) {
      onMessage(err.response?.data?.error || 'Could not save the reminder settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const { usage, preview } = settings;

  return (
    <div className="card sm:p-10">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
          <BellRing size={24} />
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-black text-secondary uppercase tracking-tight">Reminders</h3>
          <p className="text-slate-400 font-medium text-sm">When and how your patients are reminded of their appointment</p>
        </div>
      </div>

      <form onSubmit={save} className="space-y-6">
        <Toggle checked={form.enabled} onChange={(enabled) => set({ enabled })} label="Send reminders to my patients" />

        <fieldset disabled={!form.enabled} className={`space-y-6 ${form.enabled ? '' : 'opacity-50'}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="form-label">First reminder</span>
              <select className={fieldClass} value={form.hours} onChange={(e) => set({ hours: Number(e.target.value) })}>
                {settings.options.hours.map((hours) => <option key={hours} value={hours}>{hoursLabel(hours)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="form-label">Second reminder (optional)</span>
              <select className={fieldClass} value={form.secondHours ?? ''} onChange={(e) => set({ secondHours: e.target.value === '' ? null : Number(e.target.value) })} disabled={secondOptions.length === 0}>
                <option value="">No second reminder</option>
                {secondOptions.map((hours) => <option key={hours} value={hours}>{hoursLabel(hours)}</option>)}
              </select>
            </label>
          </div>

          <div>
            <span className="form-label">Send through</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
              <Toggle checked={form.whatsapp} onChange={(whatsapp) => set({ whatsapp })} label="WhatsApp" icon={<MessageCircle size={16} className="text-emerald-500" />} />
              <Toggle checked={form.email} onChange={(email) => set({ email })} label="Email (if the patient has one)" icon={<Mail size={16} className="text-primary" />} />
            </div>
            {noChannel && <p role="alert" className="text-xs font-bold text-red-500 mt-2">Choose at least one channel, or turn the reminders off.</p>}
          </div>

          <div className="grid grid-cols-1 gap-4">
            <label className="block">
              <span className="form-label">Address</span>
              <input className={fieldClass} maxLength={150} value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="e.g. Av. Amazonas N34-12 y Atahualpa, Quito" />
            </label>
            <label className="block">
              <span className="form-label">Indications</span>
              <input className={fieldClass} maxLength={200} value={form.indications} onChange={(e) => set({ indications: e.target.value })} placeholder="e.g. Arrive 10 minutes early and bring your ID" />
              <span className="text-slate-400 text-xs font-medium">Added to the reminder, on one line.</span>
            </label>
          </div>
        </fieldset>

        <div className="p-5 bg-slate-50 border border-slate-100 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">What the patient gets on WhatsApp</p>
          <p className="text-secondary text-sm font-medium leading-relaxed" data-testid="reminder-preview">{preview.text}</p>
          {preview.buttons?.length > 0 && (
            <div className="mt-3" data-testid="reminder-buttons">
              <div className="flex flex-wrap gap-2">
                {preview.buttons.map((label) => (
                  <span key={label} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-black text-primary">{label}</span>
                ))}
              </div>
              <p className="text-slate-400 text-xs font-medium mt-2">The patient answers with one tap: the agenda updates by itself, and «Cambiar hora» tells your admins and secretaries by email.</p>
            </div>
          )}
          <p className="text-slate-400 text-xs font-medium mt-3">
            The wording is a template approved by Meta (<span className="font-bold">{preview.template}</span>); only the details above change.
            {(settings.address || settings.indications) && !preview.detailsInWhatsapp && ' The address and indications go in the email until the detailed template is approved in Meta.'}
          </p>
        </div>

        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Messages sent this month</p>
          <p className="text-sm font-bold text-secondary">
            WhatsApp: {usage.whatsapp.total} <span className="text-slate-400 font-medium">({usage.whatsapp.reminders} reminders)</span>
            <span className="mx-3 text-slate-200">|</span>
            Email: {usage.email.total} <span className="text-slate-400 font-medium">({usage.email.reminders} reminders)</span>
          </p>
          <p className="text-slate-400 text-xs font-medium mt-1">Each WhatsApp message outside the 24-hour window has a cost with Meta.</p>
        </div>

        <button type="submit" disabled={saving || !changed || noChannel} className="btn-primary px-8 py-3 rounded-xl flex items-center gap-2 disabled:opacity-50">
          <Save size={18} /> {saving ? 'Saving...' : 'Save reminder settings'}
        </button>
      </form>
    </div>
  );
};

export default ReminderSettingsCard;
