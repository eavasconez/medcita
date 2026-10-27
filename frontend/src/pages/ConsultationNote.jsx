import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import Layout from '../components/Layout';
import LoadError from '../components/LoadError';
import PatientHeader from '../components/PatientHeader';
import NoteDiagnoses from '../components/NoteDiagnoses';
import VitalsForm from '../components/VitalsForm';
import useVitals from '../utils/useVitals';
import VisitVitals from '../components/VisitVitals';
import useClinicalSummary from '../utils/useClinicalSummary';
import { SECTIONS, formatDateTime } from '../utils/consultationNote';
import { canViewClinical } from '../utils/clinicalAccess';
import { EmptyState, NoteStatusBadge, Skeleton, useConfirm, useToast } from '../components/ui';
import NoteContextPanel from '../components/NoteContextPanel';
import useMediaQuery from '../utils/useMediaQuery';
import { Lock, FileText, PanelRight } from 'lucide-react';

const AUTOSAVE_DELAY_MS = 1500;

// The SOAP note of one appointment: start it from a template, write it (it saves itself as a
// draft), close it, and from then on add addenda. A closed note is read-only.
const ConsultationNote = () => {
  const { id: patientId, appointmentId } = useParams();
  const { token, user } = useContext(AuthContext);
  const headers = { Authorization: `Bearer ${token}` };
  const base = `${API_BASE_URL}/api/patients/${patientId}/clinical/notes`;

  const [patient, setPatient] = useState(null);
  const [appointment, setAppointment] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [note, setNote] = useState(null); // null: not started; the full note once it exists
  const [values, setValues] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  // The secretary never reads clinical data: the screen does not ask, it just says so
  const allowed = canViewClinical(user);
  const [loadState, setLoadState] = useState(allowed ? 'loading' : 'denied'); // loading | ready | error | denied | notfound
  const [saveState, setSaveState] = useState({ kind: 'idle' }); // idle | dirty | saving | saved | error | conflict
  const [template, setTemplate] = useState('general');
  const [addendumText, setAddendumText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(null); // the notes of the patient (for the diagnoses of earlier visits)
  // The context panel is open beside the note on a wide screen and closed (a drawer) on a phone
  const wide = useMediaQuery('(min-width: 768px)');
  const [contextOpen, setContextOpen] = useState(wide);

  // What the autosave needs to read at the moment it fires, not what it saw when it was scheduled
  const latest = useRef({ values, revision: 1, dirty: false, saving: false });
  const timer = useRef(null);
  const { summary } = useClinicalSummary(patientId, loadState === 'ready');
  const vitals = useVitals(patientId, loadState === 'ready');
  const [recordingVitals, setRecordingVitals] = useState(false);

  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const [patientRes, list, tpl] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/patients/${patientId}`, { headers }),
        axios.get(base, { headers }),
        axios.get(`${base}/templates`, { headers })
      ]);
      setPatient(patientRes.data.patient);
      setAppointment(patientRes.data.appointments.find((a) => a.id === appointmentId) || null);
      setTemplates(tpl.data);
      setNotes(list.data);
      const existing = list.data.find((n) => n.appointmentId === appointmentId);
      if (existing) {
        const full = (await axios.get(`${base}/${existing.id}`, { headers })).data;
        setNote(full);
        setValues(Object.fromEntries(SECTIONS.map((s) => [s.name, full[s.name]])));
        latest.current = { values: Object.fromEntries(SECTIONS.map((s) => [s.name, full[s.name]])), revision: full.revision, dirty: false, saving: false };
      } else {
        setNote(null);
      }
      setSaveState({ kind: 'idle' });
      setLoadState('ready');
    } catch (err) {
      const status = err.response?.status;
      setLoadState(status === 403 ? 'denied' : status === 404 ? 'notfound' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, appointmentId, token, allowed]);

  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, [load]);

  useEffect(() => {
    setContextOpen(wide);
  }, [wide]);

  const isAuthor = note && note.authorId === user?.id;
  const editable = note && note.status === 'draft' && isAuthor;

  // Saves the draft; if more was typed while it was in flight, saves again right after.
  const flush = useCallback(async () => {
    const state = latest.current;
    if (state.saving || !state.dirty || !note) return;
    state.saving = true;
    state.dirty = false;
    setSaveState({ kind: 'saving' });
    try {
      const res = await axios.put(`${base}/${note.id}`, { ...state.values, revision: state.revision }, { headers });
      state.revision = res.data.revision;
      state.saving = false;
      if (state.dirty) {
        flush();
      } else {
        setSaveState({ kind: 'saved', at: new Date() });
      }
    } catch (err) {
      state.saving = false;
      state.dirty = true;
      setSaveState({ kind: err.response?.status === 409 ? 'conflict' : 'error', message: err.response?.data?.error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, token, base]);

  // The latest flush, for the cleanup below and for leaving the page
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Leaving the screen (a link, the back button) saves what is pending; closing the tab
  // warns while something is unsaved.
  useEffect(() => {
    const warn = (e) => {
      if (latest.current.dirty || latest.current.saving) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      clearTimeout(timer.current);
      flushRef.current();
    };
  }, []);

  const edit = (name, value) => {
    const next = { ...latest.current.values, [name]: value };
    latest.current.values = next;
    latest.current.dirty = true;
    setValues(next);
    setSaveState({ kind: 'dirty' });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };

  const startNote = async () => {
    setBusy(true);
    try {
      await axios.post(base, { appointmentId, template }, { headers });
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'We couldn\'t start the note', 'error');
      if (err.response?.status === 409) await load();
    } finally {
      setBusy(false);
    }
  };

  const closeNote = async () => {
    const diagnoses = note.diagnoses.length;
    const visitVitals = (vitals.readings || []).filter((r) => r.appointmentId === appointmentId && !r.voidedAt).length;
    const summaryLine = `This note has ${diagnoses === 0 ? 'no diagnoses' : `${diagnoses} ${diagnoses === 1 ? 'diagnosis' : 'diagnoses'}`} and ${visitVitals === 0 ? 'no vital signs of this visit' : `${visitVitals} ${visitVitals === 1 ? 'set' : 'sets'} of vital signs of this visit`}.`;
    if (!(await confirm({ title: 'Close this note?', message: `${summaryLine} Once closed it cannot be edited again: later corrections are added as addenda.`, confirmLabel: 'Close note', tone: 'primary' }))) return;
    clearTimeout(timer.current);
    setBusy(true);
    try {
      // save whatever is pending first (after a save already in flight), so the closed note is
      // what is on the screen
      for (let waited = 0; latest.current.saving && waited < 50; waited += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await flush();
      if (latest.current.dirty || latest.current.saving) throw new Error('save');
      await axios.post(`${base}/${note.id}/close`, { revision: latest.current.revision }, { headers });
      await load();
      showToast('Note closed');
    } catch (err) {
      showToast(err.response?.data?.error || 'The note could not be saved, so it was not closed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteDraft = async () => {
    const diagnoses = note.diagnoses.length;
    const lost = diagnoses === 0 ? 'its four parts' : `its four parts and its ${diagnoses} ${diagnoses === 1 ? 'diagnosis' : 'diagnoses'}`;
    if (!(await confirm({ title: 'Delete this draft?', message: `This deletes ${lost}. The vital signs recorded at this visit are kept. Use it only for a note started by mistake.`, confirmLabel: 'Delete draft' }))) return;
    clearTimeout(timer.current);
    setBusy(true);
    try {
      await axios.delete(`${base}/${note.id}`, { headers });
      latest.current.dirty = false;
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || 'We couldn\'t delete the draft', 'error');
    } finally {
      setBusy(false);
    }
  };

  const addAddendum = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${base}/${note.id}/addenda`, { text: addendumText }, { headers });
      setAddendumText('');
      await load();
      showToast('Addendum added');
    } catch (err) {
      showToast(err.response?.data?.error || 'We couldn\'t add the addendum', 'error');
    } finally {
      setBusy(false);
    }
  };

  const visitLine = appointment ? `${appointment.date} ${appointment.time} · ${appointment.doctor.name}` : null;
  const statusText = (() => {
    if (!note) return '';
    if (note.status === 'closed') return `Closed ${formatDateTime(note.closedAt)} · ${note.authorName}`;
    if (!isAuthor) return `Draft by ${note.authorName} — read only`;
    return {
      idle: 'Draft — saved automatically as you type',
      dirty: 'Unsaved changes...',
      saving: 'Saving...',
      saved: saveState.at ? `Saved ${saveState.at.toLocaleTimeString([], { timeStyle: 'short' })}` : '',
      error: 'We couldn\'t save. Your text is still here; it will retry when you keep typing.',
      conflict: saveState.message || 'The note changed elsewhere.'
    }[saveState.kind];
  })();
  const problem = saveState.kind === 'error' || saveState.kind === 'conflict';

  return (
    <Layout fullHeight>
      <div className="page-shell max-w-6xl md:h-full md:flex md:flex-col md:pb-0 lg:pb-0">
        <PatientHeader
          patient={loadState === 'ready' ? patient : null}
          loading={loadState === 'loading'}
          summary={summary}
          crumb="Consultation note"
          actions={loadState === 'ready' && (
            <div className="flex flex-wrap items-center gap-3">
              {visitLine && <p className="text-sm font-semibold text-slate-500">{visitLine}</p>}
              {note && <NoteStatusBadge status={note.status} size="lg" />}
            </div>
          )}
        />

        {loadState === 'loading' && <Skeleton className="h-64 w-full rounded-3xl" />}
        {loadState === 'denied' && <EmptyState icon={Lock} title="Clinical data is not available to your role" />}
        {loadState === 'notfound' && <EmptyState title="Patient not found" />}
        {loadState === 'error' && <LoadError message="We couldn't load the note." onRetry={load} />}

        {loadState === 'ready' && (!appointment ? (
          <EmptyState title="Appointment not found for this patient" />
        ) : !note ? (
          <section className="bg-white rounded-3xl border border-slate-100 p-8 md:overflow-y-auto">
            <div className="flex items-center gap-3 mb-2"><FileText className="text-primary" size={22} /><h3 className="text-lg font-black text-secondary">Start the note of this visit</h3></div>
            <p className="text-slate-500 font-medium mb-6">Pick a template. It only puts headings in the four parts; you can change anything.</p>
            <label className="form-label" htmlFor="note-template">Template</label>
            <select id="note-template" className="form-input text-sm max-w-xs" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <div className="mt-6">
              <button onClick={startNote} disabled={busy} className="btn-primary px-8 py-3 disabled:opacity-60">Start note</button>
            </div>
          </section>
        ) : (
          <>
            <div className="md:flex md:flex-1 md:min-h-0 md:gap-6">
              <div className="md:flex-1 md:min-w-0 md:overflow-y-auto md:pr-2 md:pb-8">
                <div className="mx-auto max-w-3xl">
                  {note.status === 'draft' && !isAuthor && (
                    <div role="status" className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
                      <Lock size={18} className="mt-0.5 shrink-0" />
                      <p className="text-sm font-semibold">This draft is being written by {note.authorName}. Only they can edit it.</p>
                    </div>
                  )}
                  {note.status === 'closed' && (
                    <p className="mb-6 text-sm font-semibold text-slate-500">
                      Written by {note.authorName}, closed {formatDateTime(note.closedAt)}. It cannot be edited; add an addendum to correct or complete it.
                    </p>
                  )}

                  <section className="mb-5 bg-white rounded-3xl border border-slate-100 p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-black text-secondary uppercase tracking-widest">Vital signs of this visit</h3>
                      {!recordingVitals && (
                        <button onClick={() => setRecordingVitals(true)} className="text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">Record vitals</button>
                      )}
                    </div>
                    {recordingVitals && (
                      <VitalsForm patientId={patientId} appointmentId={appointmentId} onCancel={() => setRecordingVitals(false)} onSaved={async () => { await vitals.reload(); setRecordingVitals(false); }} />
                    )}
                    {vitals.error ? (
                      <p className="text-sm font-semibold text-red-600">We couldn't load the vital signs.</p>
                    ) : !vitals.readings ? (
                      <Skeleton className="h-16 w-full rounded-2xl" />
                    ) : (
                      <VisitVitals
                        readings={vitals.readings.filter((r) => r.appointmentId === appointmentId && !r.voidedAt)}
                        onRecord={recordingVitals ? undefined : () => setRecordingVitals(true)}
                      />
                    )}
                  </section>

                  <div className="space-y-5">
                    {SECTIONS.map((s) => (
                      <section key={s.name} className="bg-white rounded-3xl border border-slate-100 p-6">
                        <label htmlFor={`note-${s.name}`} className="flex items-center gap-3 mb-1">
                          <span className="w-8 h-8 rounded-xl bg-primary/10 text-primary font-black flex items-center justify-center">{s.letter}</span>
                          <span className="text-sm font-black text-secondary uppercase tracking-widest">{s.title}</span>
                        </label>
                        <p className="text-xs text-slate-400 font-medium mb-3 ml-11">{s.hint}</p>
                        {editable ? (
                          <textarea
                            id={`note-${s.name}`}
                            rows={s.name === 'plan' || s.name === 'subjective' ? 7 : 5}
                            className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-primary/10 outline-none resize-y"
                            value={values[s.name]}
                            onChange={(e) => edit(s.name, e.target.value)}
                          />
                        ) : (
                          <div id={`note-${s.name}`} className="whitespace-pre-wrap text-sm font-medium text-secondary bg-slate-50 rounded-2xl p-4 min-h-[3rem]">{note[s.name] || <span className="text-slate-300">—</span>}</div>
                        )}
                      </section>
                    ))}
                  </div>

                  <div className="mt-5">
                    <NoteDiagnoses
                      patientId={patientId}
                      noteId={note.id}
                      diagnoses={note.diagnoses}
                      editable={editable}
                      onChange={(diagnoses) => setNote((current) => ({ ...current, diagnoses }))}
                      onError={(message) => showToast(message, 'error')}
                    />
                  </div>

                  {note.status === 'closed' && (
                    <section className="mt-10">
                      <h3 className="text-sm font-black text-secondary uppercase tracking-widest mb-4">Addenda ({note.addenda.length})</h3>
                      {note.addenda.length > 0 && (
                        <ul className="space-y-3 mb-6">
                          {note.addenda.map((a) => (
                            <li key={a.id} className="bg-white rounded-2xl border border-slate-100 p-4">
                              <p className="whitespace-pre-wrap text-sm font-medium text-secondary">{a.text}</p>
                              <p className="mt-2 text-[11px] font-bold text-slate-400">{a.authorName} · {formatDateTime(a.createdAt)}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      <form onSubmit={addAddendum} className="bg-white rounded-3xl border border-slate-100 p-6">
                        <label className="form-label" htmlFor="addendum-text">New addendum</label>
                        <textarea id="addendum-text" required rows={3} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-medium outline-none focus:ring-4 focus:ring-primary/10" value={addendumText} onChange={(e) => setAddendumText(e.target.value)} placeholder="What is being corrected or added, and why" />
                        <div className="mt-3 flex justify-end">
                          <button type="submit" disabled={busy || !addendumText.trim()} className="px-6 py-3 bg-primary text-white font-black rounded-xl uppercase tracking-widest text-xs disabled:opacity-60">Add addendum</button>
                        </div>
                      </form>
                    </section>
                  )}
                </div>
              </div>

              {contextOpen && wide && (
                <aside className="hidden md:block w-80 shrink-0 md:overflow-y-auto pb-8">
                  <NoteContextPanel id="note-context" patientId={patientId} appointmentId={appointmentId} summary={summary} readings={vitals.error ? [] : vitals.readings} notes={notes} onClose={() => setContextOpen(false)} />
                </aside>
              )}
            </div>

            <div className="sticky bottom-0 z-20 -mx-4 -mb-4 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6 md:static md:mb-0 md:shrink-0 lg:-mx-8 lg:px-8">
              <p role="status" className={`min-w-0 flex-1 truncate text-xs font-bold ${problem ? 'text-red-600' : 'text-slate-400'}`} title={statusText}>{statusText}</p>
              {saveState.kind === 'conflict' && editable && <button onClick={load} className="shrink-0 text-xs font-black text-primary underline">Reload</button>}
              <button
                onClick={() => setContextOpen((open) => !open)}
                aria-expanded={contextOpen}
                aria-controls="note-context"
                aria-label="Show or hide the patient context"
                className="shrink-0 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-black text-secondary hover:border-primary hover:text-primary"
              >
                <PanelRight size={16} /> <span className="hidden sm:inline">Context</span>
              </button>
              {editable && (
                <>
                  <button onClick={deleteDraft} disabled={busy} className="shrink-0 px-3 py-2.5 text-red-500 font-black rounded-xl hover:bg-red-50 text-[10px] uppercase tracking-widest disabled:opacity-60 sm:px-5">Delete<span className="hidden sm:inline"> draft</span></button>
                  <button onClick={closeNote} disabled={busy} className="shrink-0 px-5 py-2.5 bg-primary text-white font-black rounded-xl shadow-lg shadow-primary/30 uppercase tracking-widest text-xs disabled:opacity-60 sm:px-8">Close note</button>
                </>
              )}
            </div>

            {contextOpen && !wide && (
              <NoteContextPanel drawer id="note-context" patientId={patientId} appointmentId={appointmentId} summary={summary} readings={vitals.error ? [] : vitals.readings} notes={notes} onClose={() => setContextOpen(false)} />
            )}
          </>
        ))}
      </div>
    </Layout>
  );
};

export default ConsultationNote;
