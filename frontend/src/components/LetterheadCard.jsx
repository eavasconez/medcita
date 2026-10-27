import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { Badge, Skeleton } from './ui';
import { FileText, Save, Upload, Trash2, Eye, ImageOff } from 'lucide-react';

const MAX_IMAGE_BYTES = 500 * 1024;
const fieldClass = 'w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-secondary/10 focus:border-secondary font-bold text-secondary text-sm';
const labelClass = 'block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2';

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

// One image of the letterhead (the logo, the signature or the seal): what it looks like now, and
// buttons to replace or remove it. The image is read through a short-lived address from the API.
const ImageSlot = ({ kind, label, hint, exists, disabled, onChange, onMessage }) => {
  const { token } = useContext(AuthContext);
  const headers = { Authorization: `Bearer ${token}` };
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!exists || disabled) return undefined;
    axios.get(`${API_BASE_URL}/api/letterhead/images/${kind}`, { headers })
      .then((res) => { if (!cancelled) setUrl(res.data.url); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exists, disabled, kind, token]);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return onMessage('The image must be a PNG or a JPG', 'error');
    if (file.size > MAX_IMAGE_BYTES) return onMessage('The image is too large (maximum 500 KB)', 'error');
    setBusy(true);
    try {
      await axios.put(`${API_BASE_URL}/api/letterhead/images/${kind}`, { data: await readAsDataUrl(file) }, { headers });
      onMessage(`${label} saved`, 'success');
      await onChange();
    } catch (err) {
      onMessage(err.response?.data?.error || 'We could not save the image', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await axios.delete(`${API_BASE_URL}/api/letterhead/images/${kind}`, { headers });
      onMessage(`${label} removed`, 'success');
      await onChange();
    } catch (err) {
      onMessage(err.response?.data?.error || 'We could not remove the image', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-100 p-4">
      <p className={labelClass}>{label}</p>
      <div className="flex h-24 items-center justify-center rounded-xl bg-slate-50 mb-3 overflow-hidden">
        {exists && url ? <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
          : exists ? <Skeleton className="h-full w-full" />
            : <span className="flex items-center gap-2 text-xs font-bold text-slate-300"><ImageOff size={16} aria-hidden="true" /> Not uploaded</span>}
      </div>
      <p className="text-[11px] font-semibold text-slate-400 mb-3">{hint}</p>
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label={`Choose the ${label.toLowerCase()} image`} onChange={upload} disabled={disabled || busy} />
        <button type="button" disabled={disabled || busy} onClick={() => input.current.click()} className="flex items-center gap-1.5 text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl disabled:opacity-50">
          <Upload size={14} /> {exists ? 'Replace' : 'Upload'}
        </button>
        {exists && (
          <button type="button" disabled={disabled || busy} onClick={remove} className="flex items-center gap-1.5 text-xs font-black text-slate-400 hover:text-red-500 px-3 py-1.5 rounded-xl disabled:opacity-50">
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>
    </div>
  );
};

// What goes on the documents MedCita issues: the doctor's professional data, their signature and
// seal, and (admins) the clinic's contact data and logo. Doctors and admins only.
const LetterheadCard = ({ onMessage }) => {
  const { token } = useContext(AuthContext);
  const headers = { Authorization: `Bearer ${token}` };
  const [state, setState] = useState(null);
  const [error, setError] = useState(false);
  const [doctor, setDoctor] = useState(null);
  const [clinic, setClinic] = useState(null);
  const [saving, setSaving] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const apply = useCallback((data) => {
    setState(data);
    setDoctor({ title: data.doctor.title || '', licenseNumber: data.doctor.licenseNumber || '', phone: data.doctor.phone || '', contactEmail: data.doctor.contactEmail || '' });
    setClinic({ address: data.clinic.address || '', phone: data.clinic.phone || '', email: data.clinic.email || '' });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/letterhead`, { headers: { Authorization: `Bearer ${token}` } });
      apply(res.data);
    } catch {
      setError(true);
    }
  }, [token, apply]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="card sm:p-10"><p className="text-sm font-bold text-red-600">We couldn't load the letterhead settings.</p></div>;
  if (!state || !doctor) return <div className="card sm:p-10" aria-busy="true"><span className="sr-only">Loading...</span><Skeleton className="h-40 w-full" /></div>;

  const save = async (which, path, body) => {
    setSaving(which);
    try {
      const res = await axios.put(`${API_BASE_URL}/api/letterhead${path}`, body, { headers });
      apply({ ...state, ...res.data });
      onMessage('Saved', 'success');
    } catch (err) {
      onMessage(err.response?.data?.error || 'We could not save', 'error');
    } finally {
      setSaving('');
    }
  };

  const preview = async () => {
    setPreviewing(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/letterhead/preview`, { headers, responseType: 'blob' });
      window.open(URL.createObjectURL(res.data), '_blank', 'noopener');
    } catch {
      onMessage('We could not build the preview', 'error');
    } finally {
      setPreviewing(false);
    }
  };

  const doctorChanged = ['title', 'licenseNumber', 'phone', 'contactEmail'].some((k) => doctor[k] !== (state.doctor[k] || ''));
  const clinicChanged = ['address', 'phone', 'email'].some((k) => clinic[k] !== (state.clinic[k] || ''));
  const noStorage = !state.storageConfigured;

  return (
    <div className="card sm:p-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-secondary rounded-2xl flex items-center justify-center text-white shadow-lg">
            <FileText size={24} />
          </div>
          <div>
            <h3 className="text-xl font-black text-secondary uppercase tracking-tight">Documents letterhead</h3>
            <p className="text-slate-400 font-medium text-sm">What prescriptions, certificates and orders print: your data and the clinic's</p>
          </div>
        </div>
        <button type="button" onClick={preview} disabled={previewing} className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-xs font-black text-primary hover:bg-primary/5 px-3 py-2 rounded-xl disabled:opacity-50">
          <Eye size={14} /> Preview letterhead
        </button>
      </div>

      {noStorage && (
        <div role="status" className="mb-6 rounded-2xl bg-amber-50 border border-amber-100 p-4 text-sm font-semibold text-amber-800">
          <Badge tone="warning" size="sm" className="mr-2">File storage not set up</Badge>
          Images can't be uploaded yet. Everything else saves, and the documents come out without logo, signature or seal.
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); save('doctor', '/doctor', doctor); }} className="space-y-5">
        <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Your professional data</h4>
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label htmlFor="lh-title" className={labelClass}>Title (printed before your name)</label>
            <input id="lh-title" className={fieldClass} value={doctor.title} maxLength={20} placeholder="Dr., Dra., Ing." onChange={(e) => setDoctor({ ...doctor, title: e.target.value })} />
          </div>
          <div>
            <label htmlFor="lh-license" className={labelClass}>Professional registration</label>
            <input id="lh-license" className={fieldClass} value={doctor.licenseNumber} maxLength={40} placeholder="Registration number" onChange={(e) => setDoctor({ ...doctor, licenseNumber: e.target.value })} />
          </div>
          <div>
            <label htmlFor="lh-phone" className={labelClass}>Phone for the documents</label>
            <input id="lh-phone" className={fieldClass} value={doctor.phone} maxLength={40} onChange={(e) => setDoctor({ ...doctor, phone: e.target.value })} />
          </div>
          <div>
            <label htmlFor="lh-email" className={labelClass}>Email for the documents</label>
            <input id="lh-email" type="email" className={fieldClass} value={doctor.contactEmail} maxLength={120} onChange={(e) => setDoctor({ ...doctor, contactEmail: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={!doctorChanged || saving === 'doctor'} className="btn-primary px-8 py-3 rounded-xl flex items-center gap-2 disabled:opacity-50">
            <Save size={16} /> {saving === 'doctor' ? 'Saving...' : 'Save my data'}
          </button>
        </div>
      </form>

      <div className="grid sm:grid-cols-2 gap-5 mt-8">
        <ImageSlot kind="signature" label="Signature" hint="PNG or JPG, up to 500 KB. Sign on white paper and photograph or scan it." exists={state.doctor.hasSignature} disabled={noStorage} onChange={load} onMessage={onMessage} />
        <ImageSlot kind="seal" label="Seal" hint="PNG or JPG, up to 500 KB. Your stamp, on a white background." exists={state.doctor.hasSeal} disabled={noStorage} onChange={load} onMessage={onMessage} />
      </div>

      {state.canEditClinic && (
        <>
          <hr className="my-8 border-slate-100" />
          <form onSubmit={(e) => { e.preventDefault(); save('clinic', '/clinic', clinic); }} className="space-y-5">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Clinic ({state.clinic.name})</h4>
            <div>
              <label htmlFor="lh-address" className={labelClass}>Address</label>
              <input id="lh-address" className={fieldClass} value={clinic.address} maxLength={200} onChange={(e) => setClinic({ ...clinic, address: e.target.value })} />
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="lh-clinic-phone" className={labelClass}>Phone</label>
                <input id="lh-clinic-phone" className={fieldClass} value={clinic.phone} maxLength={40} onChange={(e) => setClinic({ ...clinic, phone: e.target.value })} />
              </div>
              <div>
                <label htmlFor="lh-clinic-email" className={labelClass}>Email</label>
                <input id="lh-clinic-email" type="email" className={fieldClass} value={clinic.email} maxLength={120} onChange={(e) => setClinic({ ...clinic, email: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={!clinicChanged || saving === 'clinic'} className="btn-primary px-8 py-3 rounded-xl flex items-center gap-2 disabled:opacity-50">
                <Save size={16} /> {saving === 'clinic' ? 'Saving...' : 'Save clinic data'}
              </button>
            </div>
          </form>
          <div className="mt-6">
            <ImageSlot kind="logo" label="Clinic logo" hint="PNG or JPG, up to 500 KB. It goes at the top left of every document." exists={state.clinic.hasLogo} disabled={noStorage} onChange={load} onMessage={onMessage} />
          </div>
        </>
      )}
    </div>
  );
};

export default LetterheadCard;
