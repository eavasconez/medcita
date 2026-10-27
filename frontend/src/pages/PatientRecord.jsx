import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import Layout from '../components/Layout';
import LoadError from '../components/LoadError';
import PatientHeader from '../components/PatientHeader';
import PatientConsentModal from '../components/PatientConsentModal';
import PatientDataSection, { EditRecordModal } from '../components/PatientDataSection';
import RecordNav from '../components/RecordNav';
import RecordSummary from '../components/RecordSummary';
import ClinicalBackground from '../components/ClinicalBackground';
import useClinicalSummary from '../utils/useClinicalSummary';
import VitalsSection from '../components/VitalsSection';
import useVitals from '../utils/useVitals';
import useSectionSpy from '../utils/useSectionSpy';
import { AppointmentStatusBadge, EmptyState, NoteStatusBadge, SectionHeader, Skeleton, useToast } from '../components/ui';
import { canViewClinical as roleCanViewClinical } from '../utils/clinicalAccess';
import { Edit, ShieldCheck, AlertTriangle, CalendarDays, FileText, History, Download, LayoutDashboard, ClipboardList, Activity, UserRound } from 'lucide-react';
import { downloadPatientExport } from '../utils/patientExport';
import { formatDateTime, diagnosisLabel } from '../utils/consultationNote';
import { byVisit } from '../utils/recordSummary';

const secondaryAction = 'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-secondary hover:border-primary hover:text-primary transition-colors';

// The sections of the record, in order. The secretary only gets the ones that are not clinical.
const SECTIONS = [
  { id: 'summary', label: 'Summary', icon: LayoutDashboard, clinical: true },
  { id: 'background', label: 'Background', icon: ClipboardList, clinical: true },
  { id: 'vitals', label: 'Vital signs', icon: Activity, clinical: true },
  { id: 'consultations', label: 'Consultations', icon: FileText, clinical: true },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays },
  { id: 'data', label: 'Patient data', icon: UserRound }
];

// One section of the page: what the navigation jumps to. Leaves room above it for the header.
const RecordSection = ({ id, title, count, icon, actions, children }) => (
  <section id={id} aria-label={title} className="mb-10">
    <SectionHeader as="h3" icon={icon} title={count === undefined ? title : `${title} (${count})`} actions={actions} className="mb-4" />
    {children}
  </section>
);

// The record of a patient: a header that stays in place and, under it, the navigation of the sections
// next to the content, which is the only part that scrolls (from `md` up; on a phone the page scrolls
// and the navigation is a row of pills pinned under the header).
const PatientRecord = () => {
  const { id } = useParams();
  const { hash } = useLocation();
  const { token, user } = useContext(AuthContext);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [notes, setNotes] = useState(null);
  const scrollerRef = useRef(null);
  const pillsRef = useRef(null);

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

  const patient = data?.patient;
  // The role decides what to ask for; the answer of the API (re-read on every request) can only narrow it
  const canViewClinical = roleCanViewClinical(user) && data?.canViewClinical === true;

  // The consultation notes of the patient, without their text (S10-04): who wrote each one and its state
  useEffect(() => {
    if (!canViewClinical) return;
    axios.get(`${API_BASE_URL}/api/patients/${id}/clinical/notes`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setNotes(res.data))
      .catch(() => setNotes([]));
  }, [id, token, canViewClinical]);
  const noteOf = (appointmentId) => (notes || []).find((n) => n.appointmentId === appointmentId);
  // Allergies, medication and history: only for the roles that may read clinical data
  const clinical = useClinicalSummary(id, canViewClinical);
  const vitals = useVitals(id, canViewClinical);

  const sections = SECTIONS.filter((s) => canViewClinical || !s.clinical);
  const ids = sections.map((s) => s.id);
  const ready = Boolean(patient);
  const { active, goTo } = useSectionSpy(ids, { scrollerRef, pinnedRef: pillsRef, enabled: ready });

  // A link with #section opens the record there. It waits until what the clinical sections show has
  // arrived, so they have their final height and the section does not slide away afterwards.
  const settled = ready && (!canViewClinical || ((clinical.summary || clinical.error) && (vitals.readings || vitals.error) && notes !== null));
  useEffect(() => {
    const target = hash.slice(1);
    if (settled && ids.includes(target)) goTo(target, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, hash]);

  const timelineTo = canViewClinical ? `/patients/${id}/timeline` : null;
  const nav = (pills) => (
    <RecordNav items={sections} active={active} onSelect={goTo} timelineTo={timelineTo} pills={pills} navRef={pills ? pillsRef : undefined} />
  );

  return (
    <Layout fullHeight>
      <div className="page-shell md:h-full md:flex md:flex-col md:pb-0 lg:pb-0">
        {notFound || loadError ? (
          <PatientHeader patient={null} />
        ) : (
          <PatientHeader
            patient={patient}
            loading={!patient}
            summary={canViewClinical ? clinical.summary : null}
            actions={patient && (
              <>
                {canViewClinical && (
                  <Link to={timelineTo} className={secondaryAction}>
                    <History size={18} /> Timeline
                  </Link>
                )}
                {user?.role === 'admin' && (
                  <button onClick={() => exportAs('pdf')} className={secondaryAction}>
                    <Download size={18} /> Export PDF
                  </button>
                )}
                <button onClick={() => setShowConsent(true)} className={secondaryAction}>
                  <ShieldCheck size={18} /> Consent
                </button>
                <button onClick={() => setEditing(true)} className="btn-primary flex items-center justify-center gap-2 px-5 py-2.5 shadow-lg shadow-primary/20">
                  <Edit size={18} /> Edit record
                </button>
              </>
            )}
          >
            {ready && nav(true)}
          </PatientHeader>
        )}

        {notFound ? (
          <EmptyState title="Patient not found" />
        ) : loadError ? (
          <LoadError message="We couldn't load the patient." onRetry={load} />
        ) : !patient ? (
          <Skeleton className="h-64 w-full rounded-3xl" />
        ) : (
          <div className="md:flex md:flex-1 md:min-h-0 md:gap-8">
            <aside className="hidden md:block w-52 shrink-0 pb-8 md:overflow-y-auto">{nav(false)}</aside>

            <div ref={scrollerRef} className="md:flex-1 md:min-w-0 md:overflow-y-auto md:pr-3 md:pb-16">
              {patient.missingGuardian && (
                <div role="alert" className="mb-8 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
                  <AlertTriangle size={20} className="mt-0.5 shrink-0" />
                  <p className="text-sm font-semibold">
                    {patient.name} is under 18 and has no legal representative registered. Add one before recording consent or any treatment.
                  </p>
                </div>
              )}

              {canViewClinical && (
                <>
                  <RecordSection id="summary" title="Summary" icon={LayoutDashboard}>
                    <RecordSummary patientId={id} notes={notes} readings={vitals.error ? [] : vitals.readings} summary={clinical.summary} onGoTo={goTo} />
                  </RecordSection>

                  <RecordSection id="background" title="Background" icon={ClipboardList}>
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
                  </RecordSection>

                  <RecordSection id="vitals" title="Vital signs" icon={Activity}>
                    <VitalsSection patientId={id} vitals={vitals} onError={(message) => showToast(message, 'error')} />
                  </RecordSection>

                  <RecordSection id="consultations" title="Consultations" count={notes ? notes.length : undefined} icon={FileText}>
                    {!notes ? (
                      <div aria-busy="true"><span className="sr-only">Loading...</span><Skeleton className="h-20 w-full rounded-2xl" /></div>
                    ) : notes.length === 0 ? (
                      <EmptyState
                        className="py-8"
                        title="No consultations yet"
                        action={<button onClick={() => goTo('appointments')} className="text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">Pick a visit to write the first note</button>}
                      />
                    ) : (
                      <ul className="space-y-3">
                        {byVisit(notes).map((n) => (
                          <li key={n.id}>
                            <Link to={`/patients/${id}/appointments/${n.appointmentId}/note`} className="bg-white rounded-2xl border border-slate-100 hover:border-primary p-4 flex flex-wrap items-center gap-x-6 gap-y-1 transition-colors">
                              <span className="font-black text-secondary w-48 shrink-0">{n.appointment.date} · {n.appointment.time}</span>
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
                    )}
                  </RecordSection>
                </>
              )}

              <RecordSection id="appointments" title="Appointments" count={data.appointments.length} icon={CalendarDays}>
                {data.appointments.length === 0 ? (
                  <EmptyState
                    className="py-8"
                    title="No appointments yet"
                    action={<Link to="/dashboard" className="inline-block text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">Open the schedule to book the first one</Link>}
                  />
                ) : (
                  <ul className="space-y-3">
                    {data.appointments.map((a) => (
                      <li key={a.id} className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <span className="font-black text-secondary w-48 shrink-0">{a.date} · {a.time}</span>
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
              </RecordSection>

              <RecordSection id="data" title="Patient data" icon={UserRound}>
                <PatientDataSection patient={patient} />
              </RecordSection>
            </div>
          </div>
        )}
      </div>

      {showConsent && <PatientConsentModal patient={patient} onClose={() => setShowConsent(false)} onChange={load} />}
      {editing && <EditRecordModal patient={patient} onClose={() => setEditing(false)} onSaved={load} />}
    </Layout>
  );
};

export default PatientRecord;
