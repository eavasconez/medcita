import React, { useState, useContext } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { Modal, useToast } from './ui';
import { SEX_LABEL, formatAge, recordForm } from '../utils/patientRecord';
import { X } from 'lucide-react';

const Field = ({ label, children }) => (
  <div>
    <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">{label}</p>
    <p className="text-secondary font-semibold mt-0.5 break-words">{children || <span className="text-slate-300">—</span>}</p>
  </div>
);

const Card = ({ title, children, tone = 'border-slate-100' }) => (
  <section className={`bg-white rounded-3xl border p-6 ${tone}`}>
    <h4 className="text-sm font-black text-secondary uppercase tracking-widest mb-5">{title}</h4>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">{children}</div>
  </section>
);

// What the clinic knows about the patient as a person: who they are, who to call and, for a minor,
// who answers for them. Editing is in a dialog (`EditRecordModal`): it is a form of many fields.
const PatientDataSection = ({ patient }) => (
  <div className="space-y-4">
    <Card title="Personal data">
      <Field label="Date of birth">{patient.birthDate}</Field>
      <Field label="Age">{formatAge(patient.age)}</Field>
      <Field label="Sex">{SEX_LABEL[patient.sex]}</Field>
      <Field label="Occupation">{patient.occupation}</Field>
      <Field label="WhatsApp">{patient.phone}</Field>
      <Field label="Email">{patient.email}</Field>
      <Field label="Address">{patient.address}</Field>
    </Card>
    <Card title="Emergency contact and insurance">
      <Field label="Emergency contact">{patient.emergencyContactName}</Field>
      <Field label="Emergency phone">{patient.emergencyContactPhone}</Field>
      <Field label="Insurance">{patient.insuranceProvider}</Field>
      <Field label="Policy or affiliation number">{patient.insuranceNumber}</Field>
    </Card>
    {(patient.isMinor || patient.guardianName) && (
      <Card title="Legal representative" tone={patient.missingGuardian ? 'border-amber-300' : 'border-slate-100'}>
        <Field label="Full name">{patient.guardianName}</Field>
        <Field label="Relationship">{patient.guardianRelationship}</Field>
        <Field label="ID card">{patient.guardianCedula}</Field>
        <Field label="Phone">{patient.guardianPhone}</Field>
      </Card>
    )}
  </div>
);

const Input = ({ label, name, form, setForm, type = 'text', required, placeholder }) => (
  <div>
    <label className="form-label" htmlFor={`rec-${name}`}>{label}</label>
    <input
      id={`rec-${name}`}
      type={type}
      required={required}
      placeholder={placeholder}
      className="form-input text-sm"
      value={form[name]}
      onChange={(e) => setForm({ ...form, [name]: e.target.value })}
    />
  </div>
);

const FormSection = ({ title, tone = 'border-slate-100', children }) => (
  <fieldset className={`rounded-2xl border p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 ${tone}`}>
    <legend className="px-2 text-sm font-black text-secondary uppercase tracking-widest">{title}</legend>
    {children}
  </fieldset>
);

// The dialog that edits the patient's data (the three groups of the section). It saves with one
// request and tells the screen to reload; closing it with Escape or Cancel drops what was typed.
export const EditRecordModal = ({ patient, onClose, onSaved }) => {
  const { token } = useContext(AuthContext);
  const { showToast } = useToast();
  const [form, setForm] = useState(() => recordForm(patient));
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.put(`${API_BASE_URL}/api/patients/${patient.id}`, form, { headers: { Authorization: `Bearer ${token}` } });
      await onSaved();
      onClose();
      showToast('Record updated');
    } catch (err) {
      showToast(err.response?.data?.error || 'We couldn\'t save the record', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="edit-record-title" size="lg" panelClassName="p-6 sm:p-8">
      <div className="flex items-start justify-between mb-6">
        <div className="min-w-0">
          <h3 id="edit-record-title" className="text-2xl font-black text-secondary">Edit record</h3>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest truncate">{patient.name}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-50 rounded-xl"><X size={20} className="text-slate-400" /></button>
      </div>

      <form onSubmit={save} className="space-y-5">
        <FormSection title="Personal data">
          <Input label="Full name" name="name" form={form} setForm={setForm} required />
          <Input label="ID card" name="cedula" form={form} setForm={setForm} />
          <Input label="WhatsApp" name="phone" form={form} setForm={setForm} required />
          <Input label="Email" name="email" form={form} setForm={setForm} type="email" />
          <div>
            <label className="form-label" htmlFor="rec-birthDate">Date of birth</label>
            <input id="rec-birthDate" type="date" max={today} className="form-input text-sm" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
          </div>
          <div>
            <label className="form-label" htmlFor="rec-sex">Sex</label>
            <select id="rec-sex" className="form-input text-sm" value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
              <option value="">Not specified</option>
              {Object.entries(SEX_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <Input label="Address" name="address" form={form} setForm={setForm} />
          <Input label="Occupation" name="occupation" form={form} setForm={setForm} />
        </FormSection>

        <FormSection title="Emergency contact and insurance">
          <Input label="Emergency contact" name="emergencyContactName" form={form} setForm={setForm} />
          <Input label="Emergency phone" name="emergencyContactPhone" form={form} setForm={setForm} />
          <Input label="Insurance" name="insuranceProvider" form={form} setForm={setForm} placeholder="Ex: IESS, private insurer" />
          <Input label="Policy or affiliation number" name="insuranceNumber" form={form} setForm={setForm} />
        </FormSection>

        <FormSection title="Legal representative (patients under 18)" tone={patient.missingGuardian ? 'border-amber-300' : 'border-slate-100'}>
          <Input label="Full name" name="guardianName" form={form} setForm={setForm} />
          <Input label="Relationship" name="guardianRelationship" form={form} setForm={setForm} placeholder="Ex: Mother" />
          <Input label="ID card" name="guardianCedula" form={form} setForm={setForm} />
          <Input label="Phone" name="guardianPhone" form={form} setForm={setForm} />
        </FormSection>

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-6 py-3 text-slate-400 font-black hover:bg-slate-50 rounded-xl uppercase tracking-widest text-[10px]">Cancel</button>
          <button type="submit" disabled={saving} className="px-8 py-3 bg-primary text-white font-black rounded-xl shadow-xl shadow-primary/30 uppercase tracking-widest text-xs disabled:opacity-60">
            {saving ? 'Saving...' : 'Save record'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default PatientDataSection;
