import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import Layout from '../components/Layout';
import LoadError from '../components/LoadError';
import ConsentBadge from '../components/ConsentBadge';
import PatientConsentModal from '../components/PatientConsentModal';
import { statusLabel, statusColor } from '../utils/appointmentStatus';
import { SEX_LABEL, formatAge, recordForm } from '../utils/patientRecord';
import { ArrowLeft, Edit, ShieldCheck, AlertTriangle, CheckCircle2, AlertCircle, X, CalendarDays } from 'lucide-react';

const Field = ({ label, children }) => (
  <div>
    <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">{label}</p>
    <p className="text-secondary font-semibold mt-0.5 break-words">{children || <span className="text-slate-300">—</span>}</p>
  </div>
);

const Card = ({ title, children, tone = 'border-slate-100' }) => (
  <section className={`bg-white rounded-3xl border p-6 ${tone}`}>
    <h3 className="text-sm font-black text-secondary uppercase tracking-widest mb-5">{title}</h3>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">{children}</div>
  </section>
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

const PatientRecord = () => {
  const { id } = useParams();
  const { token } = useContext(AuthContext);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConsent, setShowConsent] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/patients/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setData(res.data);
      setLoadError(false);
      setNotFound(false);
    } catch (err) {
      if (err.response?.status === 404) setNotFound(true);
      else setLoadError(true);
    }
  }, [id, token]);

  useEffect(() => {
    load();
  }, [load]);

  const startEditing = () => {
    setForm(recordForm(data.patient));
    setEditing(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.put(`${API_BASE_URL}/api/patients/${id}`, form, { headers: { Authorization: `Bearer ${token}` } });
      setEditing(false);
      await load();
      showToast('Record updated');
    } catch (err) {
      showToast(err.response?.data?.error || 'We couldn\'t save the record', 'error');
    } finally {
      setSaving(false);
    }
  };

  const patient = data?.patient;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Layout>
      {toast && (
        <div className={`toast ${toast.type === 'success' ? 'bg-[#10b981] shadow-[#10b981]/30' : 'bg-red-500 shadow-red-500/30'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          <span className="text-sm shadow-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-auto hover:opacity-75"><X size={18} /></button>
        </div>
      )}

      <div className="page-shell">
        <Link to="/patients" className="inline-flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-primary mb-6">
          <ArrowLeft size={16} /> Patients
        </Link>

        {notFound ? (
          <div className="py-20 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
            <p className="text-slate-400 font-bold text-xl">Patient not found</p>
          </div>
        ) : loadError ? (
          <LoadError message="We couldn't load the patient." onRetry={load} />
        ) : !patient ? (
          <div className="flex justify-center py-20 animate-pulse"><span className="text-slate-400 font-semibold text-lg">Loading record...</span></div>
        ) : (
          <>
            <header className="page-header">
              <div>
                <h2 className="text-3xl font-black text-secondary tracking-tight">{patient.name}</h2>
                <p className="text-slate-500 font-medium mt-1">
                  {[formatAge(patient.age), patient.sex && SEX_LABEL[patient.sex], patient.cedula].filter(Boolean).join(' · ') || 'Patient record'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ConsentBadge consent={patient.consent} />
                  {patient.isMinor && <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-sky-50 text-sky-700">Minor</span>}
                </div>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <button onClick={() => setShowConsent(true)} className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-slate-200 text-sm font-bold text-secondary hover:border-primary hover:text-primary transition-colors">
                  <ShieldCheck size={18} /> Consent
                </button>
                {!editing && (
                  <button onClick={startEditing} className="btn-primary flex items-center justify-center gap-2 px-6 py-3 shadow-lg shadow-primary/20">
                    <Edit size={18} /> Edit record
                  </button>
                )}
              </div>
            </header>

            {patient.missingGuardian && (
              <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
                <AlertTriangle size={20} className="mt-0.5 shrink-0" />
                <p className="text-sm font-semibold">
                  {patient.name} is under 18 and has no legal representative registered. Add one before recording consent or any treatment.
                </p>
              </div>
            )}

            {editing ? (
              <form onSubmit={save} className="space-y-6">
                <section className="bg-white rounded-3xl border border-slate-100 p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <h3 className="sm:col-span-2 text-sm font-black text-secondary uppercase tracking-widest">Personal data</h3>
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
                </section>

                <section className="bg-white rounded-3xl border border-slate-100 p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <h3 className="sm:col-span-2 text-sm font-black text-secondary uppercase tracking-widest">Emergency contact and insurance</h3>
                  <Input label="Emergency contact" name="emergencyContactName" form={form} setForm={setForm} />
                  <Input label="Emergency phone" name="emergencyContactPhone" form={form} setForm={setForm} />
                  <Input label="Insurance" name="insuranceProvider" form={form} setForm={setForm} placeholder="Ex: IESS, private insurer" />
                  <Input label="Policy or affiliation number" name="insuranceNumber" form={form} setForm={setForm} />
                </section>

                <section className={`bg-white rounded-3xl border p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 ${patient.missingGuardian ? 'border-amber-300' : 'border-slate-100'}`}>
                  <h3 className="sm:col-span-2 text-sm font-black text-secondary uppercase tracking-widest">Legal representative (patients under 18)</h3>
                  <Input label="Full name" name="guardianName" form={form} setForm={setForm} />
                  <Input label="Relationship" name="guardianRelationship" form={form} setForm={setForm} placeholder="Ex: Mother" />
                  <Input label="ID card" name="guardianCedula" form={form} setForm={setForm} />
                  <Input label="Phone" name="guardianPhone" form={form} setForm={setForm} />
                </section>

                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={() => setEditing(false)} className="px-6 py-3 text-slate-400 font-black hover:bg-slate-50 rounded-xl uppercase tracking-widest text-[10px]">Cancel</button>
                  <button type="submit" disabled={saving} className="px-8 py-3 bg-primary text-white font-black rounded-xl shadow-xl shadow-primary/30 uppercase tracking-widest text-xs disabled:opacity-60">
                    {saving ? 'Saving...' : 'Save record'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-6">
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
            )}

            <section className="mt-8">
              <h3 className="text-sm font-black text-secondary uppercase tracking-widest mb-4 flex items-center gap-2">
                <CalendarDays size={16} className="text-primary" /> Appointments ({data.appointments.length})
              </h3>
              {data.appointments.length === 0 ? (
                <p className="text-slate-400 font-medium bg-white rounded-3xl border border-dashed border-slate-200 p-8 text-center">No appointments yet</p>
              ) : (
                <ul className="space-y-3">
                  {data.appointments.map((a) => (
                    <li key={a.id} className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                      <span className="font-black text-secondary w-40">{a.date} · {a.time}</span>
                      <span className="text-sm text-slate-500 font-medium flex-1 min-w-40">
                        {a.doctor.name}{a.type ? ` · ${a.type.name}` : ''}
                      </span>
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-white" style={{ background: statusColor(a.status) }}>
                        {statusLabel(a.status)}
                      </span>
                      {data.canViewClinical && a.notes && <p className="basis-full text-sm text-slate-500 border-t border-slate-50 pt-2">{a.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {showConsent && <PatientConsentModal patient={patient} onClose={() => setShowConsent(false)} onChange={load} />}
    </Layout>
  );
};

export default PatientRecord;
