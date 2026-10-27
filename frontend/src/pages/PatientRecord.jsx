import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import Layout from '../components/Layout';
import LoadError from '../components/LoadError';
import ConsentBadge from '../components/ConsentBadge';
import PatientConsentModal from '../components/PatientConsentModal';
import ClinicalAlert from '../components/ClinicalAlert';
import ClinicalBackground from '../components/ClinicalBackground';
import useClinicalSummary from '../utils/useClinicalSummary';
import VitalsSection from '../components/VitalsSection';
import useVitals from '../utils/useVitals';
import { AppointmentStatusBadge, EmptyState, MinorBadge, NoteStatusBadge, SectionHeader, Skeleton, useToast } from '../components/ui';
import { SEX_LABEL, formatAge, recordForm } from '../utils/patientRecord';
import { ArrowLeft, Edit, ShieldCheck, AlertTriangle, X, CalendarDays, FileText, History, Download } from 'lucide-react';
import { downloadPatientExport } from '../utils/patientExport';
import { formatDateTime, diagnosisLabel } from '../utils/consultationNote';

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
  const { token, user } = useContext(AuthContext);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [notes, setNotes] = useState([]);

  const { showToast } = useToast();

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

  // The whole record of the patient as a file (admins; written to the activity log)
  const exportAs = async (format) => {
    try {
      await downloadPatientExport(id, format, token);
      showToast(format === 'pdf' ? 'PDF downloaded' : 'Data exported');
    } catch {
      showToast('We couldn\'t export the data', 'error');
    }
  };

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
  const canViewClinical = data?.canViewClinical === true;

  // The consultation notes of the patient, without their text (S10-04): who wrote each one and its state
  useEffect(() => {
    if (!canViewClinical) return;
    axios.get(`${API_BASE_URL}/api/patients/${id}/clinical/notes`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setNotes(res.data))
      .catch(() => setNotes([]));
  }, [id, token, canViewClinical]);
  const noteOf = (appointmentId) => notes.find((n) => n.appointmentId === appointmentId);
  // Allergies, medication and history: only for the roles that may read clinical data
  const clinical = useClinicalSummary(id, data?.canViewClinical === true);
  const vitals = useVitals(id, data?.canViewClinical === true);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Layout>
      <div className="page-shell">
        <Link to="/patients" className="inline-flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-primary mb-6">
          <ArrowLeft size={16} /> Patients
        </Link>

        {notFound ? (
          <EmptyState title="Patient not found" />
        ) : loadError ? (
          <LoadError message="We couldn't load the patient." onRetry={load} />
        ) : !patient ? (
          <div aria-busy="true" className="space-y-4">
            <span className="sr-only">Loading record...</span>
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-64 w-full rounded-3xl" />
          </div>
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
                  {patient.isMinor && <MinorBadge />}
                </div>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                {canViewClinical && (
                  <Link to={`/patients/${id}/timeline`} className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-slate-200 text-sm font-bold text-secondary hover:border-primary hover:text-primary transition-colors">
                    <History size={18} /> Timeline
                  </Link>
                )}
                {user?.role === 'admin' && (
                  <button onClick={() => exportAs('pdf')} className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-slate-200 text-sm font-bold text-secondary hover:border-primary hover:text-primary transition-colors">
                    <Download size={18} /> Export PDF
                  </button>
                )}
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

            {data.canViewClinical && clinical.summary && <div className="mb-6"><ClinicalAlert summary={clinical.summary} /></div>}

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

            {data.canViewClinical && (
              <section className="mt-8">
                <SectionHeader as="h3" variant="label" title="Clinical background" className="mb-4" />
                {clinical.summary ? (
                  <ClinicalBackground patientId={id} summary={clinical.summary} onChange={clinical.reload} onError={(message) => showToast(message, 'error')} />
                ) : clinical.error ? (
                  <LoadError message="We couldn't load the clinical background." onRetry={clinical.reload} />
                ) : (
                  <div aria-busy="true">
                    <span className="sr-only">Loading...</span>
                    <Skeleton className="h-24 w-full rounded-3xl" />
                  </div>
                )}
              </section>
            )}

            {canViewClinical && (
              <section className="mt-8">
                <SectionHeader as="h3" variant="label" title="Vital signs" className="mb-4" />
                <VitalsSection patientId={id} vitals={vitals} onError={(message) => showToast(message, 'error')} />
              </section>
            )}

            {canViewClinical && notes.length > 0 && (
              <section className="mt-8">
                <SectionHeader as="h3" variant="label" icon={FileText} title={`Consultation notes (${notes.length})`} className="mb-4" />
                <ul className="space-y-3">
                  {notes.map((n) => (
                    <li key={n.id}>
                      <Link to={`/patients/${id}/appointments/${n.appointmentId}/note`} className="bg-white rounded-2xl border border-slate-100 hover:border-primary p-4 flex flex-wrap items-center gap-x-6 gap-y-1 transition-colors">
                        <span className="font-black text-secondary w-40">{n.appointment.date} · {n.appointment.time}</span>
                        <span className="text-sm text-slate-500 font-medium flex-1 min-w-40">
                          {n.authorName} · {formatDateTime(n.status === 'closed' ? n.closedAt : n.updatedAt)}
                          {n.principalDiagnosis ? ` · ${n.principalDiagnosis.code ? `${n.principalDiagnosis.code} ` : ''}${diagnosisLabel(n.principalDiagnosis.name)}` : ''}
                          {n.addendaCount > 0 ? ` · ${n.addendaCount} ${n.addendaCount === 1 ? 'addendum' : 'addenda'}` : ''}
                        </span>
                        <NoteStatusBadge status={n.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-8">
              <SectionHeader as="h3" variant="label" icon={CalendarDays} title={`Appointments (${data.appointments.length})`} className="mb-4" />
              {data.appointments.length === 0 ? (
                <EmptyState className="py-8">No appointments yet</EmptyState>
              ) : (
                <ul className="space-y-3">
                  {data.appointments.map((a) => (
                    <li key={a.id} className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                      <span className="font-black text-secondary w-40">{a.date} · {a.time}</span>
                      <span className="text-sm text-slate-500 font-medium flex-1 min-w-40">
                        {a.doctor.name}{a.type ? ` · ${a.type.name}` : ''}
                      </span>
                      <AppointmentStatusBadge status={a.status} />
                      {canViewClinical && a.status !== 'cancelled' && (
                        <Link
                          to={`/patients/${id}/appointments/${a.id}/note`}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-black text-primary hover:border-primary transition-colors"
                        >
                          <FileText size={14} />
                          {!noteOf(a.id) ? 'Write note' : noteOf(a.id).status === 'closed' ? 'Open note' : 'Continue draft'}
                        </Link>
                      )}
                      {a.notes && <p className="basis-full text-sm text-slate-500 border-t border-slate-50 pt-2"><span className="font-black text-slate-400 text-[10px] uppercase tracking-widest mr-2">Booking note</span>{a.notes}</p>}
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
