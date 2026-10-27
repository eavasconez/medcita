import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import Layout from '../components/Layout';
import LoadError from '../components/LoadError';
import PatientConsentModal from '../components/PatientConsentModal';
import PatientActions from '../components/PatientActions';
import RecentPatients from '../components/RecentPatients';
import ConsentBadge from '../components/ConsentBadge';
import { EmptyState, MinorBadge, Modal, Skeleton, useConfirm, useToast } from '../components/ui';
import { formatAge } from '../utils/patientRecord';
import { downloadPatientExport } from '../utils/patientExport';
import { readRecentPatients, forgetPatient } from '../utils/recentPatients';
import useDebouncedValue from '../utils/useDebouncedValue';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  User,
  CreditCard,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown
} from 'lucide-react';

const SEARCH_DELAY_MS = 300;

const CONSENT_FILTERS = [
  ['', 'Any consent'],
  ['granted', 'Consent given'],
  ['none', 'Consent pending'],
  ['outdated', 'Old consent text'],
  ['withdrawn', 'Consent withdrawn']
];
const MINOR_FILTERS = [['', 'All ages'], ['true', 'Minors'], ['false', 'Adults']];

// How the list can be ordered (the API's columns). The default is the newest first.
const SORT_OPTIONS = [
  ['createdAt:desc', 'Newest first'],
  ['createdAt:asc', 'Oldest first'],
  ['name:asc', 'Name A–Z'],
  ['name:desc', 'Name Z–A'],
  ['age:asc', 'Youngest first'],
  ['age:desc', 'Oldest patients first']
];
const DEFAULT_SORT = { sort: 'createdAt', order: 'desc' };

// A header of the table that orders it: first click ascending, second descending, third back to the
// default order
const SortHeader = ({ column, label, current, onSort, className = '' }) => {
  const active = current.sort === column;
  const Icon = !active ? ChevronsUpDown : current.order === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th scope="col" aria-sort={active ? (current.order === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-2.5 py-3 text-left ${className}`}>
      <button type="button" onClick={() => onSort(column)} className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-widest transition-colors ${active ? 'text-primary' : 'text-slate-400 hover:text-secondary'}`}>
        {label} <Icon size={12} aria-hidden="true" />
      </button>
    </th>
  );
};

const Patients = () => {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');
  const [consent, setConsent] = useState('');
  const [minor, setMinor] = useState('');
  const [order, setOrder] = useState(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentPatientId, setCurrentPatientId] = useState(null);
  const { token, user } = useContext(AuthContext);
  const [consentPatient, setConsentPatient] = useState(null);
  const [recent, setRecent] = useState(() => readRecentPatients(user));
  const fetchAbortRef = useRef(null);
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [formData, setFormData] = useState({
    name: '',
    phone: '+593',
    email: '',
    cedula: ''
  });

  // The server is asked once the person stops typing, not on every key
  const term = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const filtering = Boolean(consent || minor);

  // Uses axios' `params` (not string interpolation) so a query containing &/#/+ doesn't get mangled,
  // and cancels any still-in-flight previous request so a slower older response can't overwrite
  // fresher results (e.g. typing "Ana" then quickly "An" - the "Ana" response landing last).
  const fetchPatients = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/api/patients`, {
        params: {
          page,
          ...(term && { search: term }),
          ...(consent && { consent }),
          ...(minor && { minor }),
          // the default order is the server's: it is not sent
          ...(order !== DEFAULT_SORT && { sort: order.sort, order: order.order })
        },
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      setPatients(res.data.patients);
      setTotal(res.data.total);
      setTotalPages(res.data.totalPages);
      setLoadError(false);
    } catch (err) {
      if (err.code !== 'ERR_CANCELED') {
        console.error(err);
        setLoadError(true);
      }
    } finally {
      if (fetchAbortRef.current === controller) setLoading(false);
    }
  }, [token, page, term, consent, minor, order]);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  // What the person asks for changes: back to the first page
  const change = (apply) => (value) => {
    apply(value);
    setPage(1);
  };

  const sortBy = (column) => {
    setPage(1);
    setOrder((current) => {
      if (current.sort !== column) return { sort: column, order: 'asc' };
      return current.order === 'asc' ? { sort: column, order: 'desc' } : DEFAULT_SORT;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setConsent('');
    setMinor('');
    setPage(1);
  };

  // The whole record of one patient as a file (access and portability); admins only, and
  // every export is written to the activity log.
  const handleExport = async (patient, format = 'json') => {
    try {
      await downloadPatientExport(patient.id, format, token);
      showToast(format === 'pdf' ? 'PDF downloaded' : 'Data exported');
    } catch {
      showToast('We couldn\'t export the data', 'error');
    }
  };

  const goToPage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    setPage(nextPage);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await axios.put(`${API_BASE_URL}/api/patients/${currentPatientId}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        showToast('Patient updated successfully');
      } else {
        await axios.post(`${API_BASE_URL}/api/patients`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        showToast('Patient registered successfully');
      }
      setShowModal(false);
      setFormData({ name: '', phone: '+593', email: '', cedula: '' });
      setIsEditing(false);
      setCurrentPatientId(null);
      fetchPatients();
    } catch (err) {
      showToast(err.response?.data?.error || 'Error processing request', 'error');
    }
  };

  const handleDelete = async (patient) => {
    if (!(await confirm({ title: `Delete ${patient.name}?`, message: 'This cannot be undone.', confirmLabel: 'Delete' }))) return;
    try {
      await axios.delete(`${API_BASE_URL}/api/patients/${patient.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showToast('Patient deleted');
      forgetPatient(user, patient.id);
      setRecent(readRecentPatients(user));
      // deleting the last patient of a page: go back one page instead of showing an empty one
      if (patients.length === 1 && page > 1) setPage(page - 1);
      else fetchPatients();
    } catch (err) {
      showToast(err.response?.data?.error || 'Error deleting patient', 'error');
    }
  };

  const openCreateModal = () => {
    setFormData({ name: '', phone: '+593', email: '', cedula: '' });
    setIsEditing(false);
    setCurrentPatientId(null);
    setShowModal(true);
  };

  const openEditModal = (patient) => {
    setFormData({
      name: patient.name,
      phone: patient.phone,
      email: patient.email || '',
      cedula: patient.cedula || ''
    });
    setIsEditing(true);
    setCurrentPatientId(patient.id);
    setShowModal(true);
  };

  const actions = (p) => (
    <PatientActions patient={p} isAdmin={isAdmin} onConsent={setConsentPatient} onExport={handleExport} onEdit={openEditModal} onDelete={handleDelete} />
  );

  // Three different "nothing": no patients at all, none for what was typed, none for the filters
  const emptyState = (() => {
    if (term && !filtering) {
      return (
        <EmptyState className="col-span-full" icon={Search} title={`No patients match "${term}"`}
          action={<button onClick={clearFilters} className="text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">Clear the search</button>}>
          Check the spelling, or search by ID card or phone
        </EmptyState>
      );
    }
    if (filtering) {
      return (
        <EmptyState className="col-span-full" icon={Users} title="No patients match these filters"
          action={<button onClick={clearFilters} className="text-xs font-black text-primary hover:bg-primary/5 px-3 py-1.5 rounded-xl">Clear filters</button>}>
          {term ? 'Try another term or loosen the filters' : 'Try loosening them'}
        </EmptyState>
      );
    }
    return (
      <EmptyState className="col-span-full" icon={Users} title="No patients yet"
        action={<button onClick={openCreateModal} className="btn-primary inline-flex items-center gap-2 px-5 py-2.5"><Plus size={16} /> Register the first patient</button>}>
        Register one to start the directory
      </EmptyState>
    );
  })();

  const field = 'w-full min-w-0 sm:w-auto rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-secondary outline-none focus:border-primary focus:ring-4 focus:ring-primary/10';

  return (
    <Layout>
      <div className="page-shell">
        <header className="page-header">
          <div>
            <h2 className="page-title">My Patients</h2>
            <p className="text-slate-500 font-medium mt-1">Complete directory of registered patients</p>
          </div>
          <button
            onClick={openCreateModal}
            className="btn-primary flex items-center justify-center gap-2 px-6 py-3 shadow-lg shadow-primary/20 w-full sm:w-auto"
          >
            <Plus size={20} /> New Patient
          </button>
        </header>

        <RecentPatients patients={recent} />

        {/* Search Bar */}
        <div className="relative mb-4 group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={20} />
          <input
            type="text"
            placeholder="Search by name, ID or phone..."
            aria-label="Search patients"
            value={search}
            onChange={(e) => change(setSearch)(e.target.value)}
            className="w-full pl-14 pr-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all shadow-sm text-lg font-medium"
          />
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
          <select aria-label="Filter by consent" value={consent} onChange={(e) => change(setConsent)(e.target.value)} className={field}>
            {CONSENT_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="Filter by age" value={minor} onChange={(e) => change(setMinor)(e.target.value)} className={field}>
            {MINOR_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select
            aria-label="Sort by"
            value={`${order.sort}:${order.order}`}
            onChange={(e) => { const [sort, direction] = e.target.value.split(':'); setOrder({ sort, order: direction }); setPage(1); }}
            className={`${field} col-span-2 md:hidden`}
          >
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {(filtering || term) && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-primary px-2 py-2">
              <X size={14} /> Clear
            </button>
          )}
          {!loading && !loadError && <p role="status" className="text-xs font-bold text-slate-400 sm:ml-auto">{total} {total === 1 ? 'patient' : 'patients'}</p>}
        </div>

        {loadError ? (
          <LoadError message="We couldn't load the patients." onRetry={fetchPatients} />
        ) : loading ? (
          <div aria-busy="true">
            <span className="sr-only">Loading directory...</span>
            <div className="hidden md:block space-y-2">
              <Skeleton className="h-11 rounded-2xl" />
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
            </div>
            <div className="entity-grid md:hidden">
              {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-52 rounded-3xl" />)}
            </div>
          </div>
        ) : patients.length === 0 ? (
          <div className="grid grid-cols-1">{emptyState}</div>
        ) : (
          <>
            {/* From md up: a table whose whole row opens the record */}
            <div className="hidden md:block overflow-x-auto rounded-3xl border border-slate-100 bg-white">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Patients</caption>
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr>
                    <SortHeader column="name" label="Patient" current={order} onSort={sortBy} />
                    <SortHeader column="age" label="Age" current={order} onSort={sortBy} />
                    <SortHeader column="cedula" label="ID card" current={order} onSort={sortBy} />
                    <SortHeader column="phone" label="Phone" current={order} onSort={sortBy} />
                    <th scope="col" className="px-2.5 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Consent</th>
                    <th scope="col" className="px-2.5 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">Appts</th>
                    <th scope="col" className="px-1 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {patients.map((p) => (
                    <tr key={p.id} onClick={() => navigate(`/patients/${p.id}`)} className="cursor-pointer transition-colors hover:bg-primary/5">
                      <td className="min-w-[8rem] px-2.5 py-3">
                        <Link to={`/patients/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-extrabold text-secondary hover:text-primary">{p.name}</Link>
                        {p.email && <p className="max-w-[16rem] truncate text-xs font-medium text-slate-400">{p.email}</p>}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 font-semibold text-slate-500">
                        {p.age ? formatAge(p.age) : <span className="text-slate-300">—</span>}
                        {p.isMinor && <span className="ml-1.5 align-middle"><MinorBadge size="sm" /></span>}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 font-semibold text-slate-500">{p.cedula || <span className="text-slate-300">—</span>}</td>
                      <td className="whitespace-nowrap px-2.5 py-3 font-semibold text-slate-500">{p.phone}</td>
                      <td className="px-2.5 py-3"><ConsentBadge consent={p.consent} size="sm" /></td>
                      <td className="px-2.5 py-3 text-right font-black text-secondary">{p._count?.appointments || 0}</td>
                      <td className="px-1 py-2">{actions(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* On a phone: the cards */}
            <div className="entity-grid md:hidden">
              {patients.map((p) => (
                <div key={p.id} onClick={() => navigate(`/patients/${p.id}`)} className="bg-white p-6 rounded-3xl border border-slate-100 hover:border-primary hover:shadow-xl hover:shadow-primary/5 transition-all group cursor-pointer">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                      <User size={28} />
                    </div>
                    <div className="max-w-[60%] overflow-x-auto">{actions(p)}</div>
                  </div>

                  <h3 className="text-xl font-extrabold text-secondary mb-1 truncate">
                    <Link to={`/patients/${p.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary transition-colors">{p.name}</Link>
                  </h3>
                  {p.age && <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">{formatAge(p.age)}{p.isMinor ? ' · Minor' : ''}</p>}
                  <ConsentBadge consent={p.consent} />
                  <div className="space-y-2 mt-4">
                    <p className="flex items-center gap-2 text-slate-500 text-sm font-medium">
                      <CreditCard size={14} className="text-primary" /> {p.cedula || 'No ID'}
                    </p>
                    <p className="flex items-center gap-2 text-slate-500 text-sm font-medium">
                      <Phone size={14} className="text-primary" /> {p.phone}
                    </p>
                    {p.email && (
                      <p className="flex items-center gap-2 text-slate-500 text-sm font-medium">
                        <Mail size={14} className="text-primary" /> {p.email}
                      </p>
                    )}
                  </div>

                  <div className="mt-6 pt-6 border-t border-slate-50 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest leading-none">Registered Appointments</p>
                      <p className="text-2xl font-black text-secondary mt-1">{p._count?.appointments || 0}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
              className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:border-primary hover:text-primary disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-500 transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-bold text-slate-500">Page {page} of {totalPages}</span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:border-primary hover:text-primary disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-500 transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Modal Nuevo Paciente */}
      {showModal && (
        <Modal onClose={() => setShowModal(false)} labelledBy="patient-modal-title" size="sm">
          <div className="bg-primary p-6 sm:p-8 text-white relative">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setShowModal(false)}
              className="absolute right-6 top-6 hover:rotate-90 transition-transform"
            >
              <X size={24} />
            </button>
            <h3 id="patient-modal-title" className="text-2xl font-black tracking-tighter">
              {isEditing ? 'Edit Patient' : 'Register Patient'}
            </h3>
            <p className="text-white/60 font-medium mt-1 text-sm">
              {isEditing ? 'Update patient details' : 'Enter details for the new patient'}
            </p>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-4">
            <div>
              <label className="form-label">Full Name</label>
              <input
                required
                className="form-input text-sm"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="Ex: John Doe"
              />
            </div>

            <div>
              <label className="form-label">ID Card (Optional)</label>
              <input
                className="form-input text-sm"
                value={formData.cedula}
                onChange={(e) => setFormData({...formData, cedula: e.target.value})}
                placeholder="Ex: 1723456789"
              />
            </div>

            <div>
              <label className="form-label">WhatsApp</label>
              <input
                required
                className="form-input text-sm"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
              />
            </div>

            <div>
              <label className="form-label">Email (Optional)</label>
              <input
                type="email"
                className="form-input text-sm"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                placeholder="patient@example.com"
              />
            </div>
            
            <div className="flex gap-3 pt-4">
              <button 
                type="button"
                onClick={() => setShowModal(false)}
                className="flex-1 py-3 text-slate-400 font-black hover:bg-slate-50 rounded-xl transition-colors uppercase tracking-widest text-[10px]"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="flex-[2] py-3 bg-primary text-white font-black rounded-xl shadow-xl shadow-primary/30 hover:shadow-primary/40 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest text-xs"
              >
                {isEditing ? 'Update Patient' : 'Save Patient'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    {consentPatient && (
        <PatientConsentModal
          patient={consentPatient}
          onClose={() => setConsentPatient(null)}
          onChange={fetchPatients}
        />
      )}
    </Layout>
  );
};

export default Patients;
