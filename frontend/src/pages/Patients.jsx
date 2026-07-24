import React, { useState, useEffect, useContext, useRef } from 'react';
import axios from 'axios';
import { AuthContext } from '../App';
import Layout from '../components/Layout';
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  Edit,
  User,
  CreditCard,
  X,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

const Patients = () => {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentPatientId, setCurrentPatientId] = useState(null);
  const [toast, setToast] = useState(null);
  const { token } = useContext(AuthContext);
  const fetchAbortRef = useRef(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const [formData, setFormData] = useState({
    name: '',
    phone: '+593',
    email: '',
    cedula: ''
  });

  // Uses axios' `params` (not string interpolation) so a query containing
  // &/#/+ doesn't get mangled, and cancels any still-in-flight previous
  // request so a slower older response can't overwrite fresher results
  // (e.g. typing "Ana" then quickly "An" - the "Ana" response landing last).
  const fetchPatients = async (query = '', pageNum = 1) => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    try {
      setLoading(true);
      const res = await axios.get('http://localhost:5000/api/patients', {
        params: { search: query, page: pageNum },
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      setPatients(res.data.patients);
      setTotalPages(res.data.totalPages);
      setPage(res.data.page);
    } catch (err) {
      if (err.code !== 'ERR_CANCELED') console.error(err);
    } finally {
      if (fetchAbortRef.current === controller) setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
  }, []);

  const handleSearch = (e) => {
    setSearch(e.target.value);
    fetchPatients(e.target.value, 1);
  };

  const goToPage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    fetchPatients(search, nextPage);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await axios.put(`http://localhost:5000/api/patients/${currentPatientId}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        showToast('Patient updated successfully');
      } else {
        await axios.post('http://localhost:5000/api/patients', formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        showToast('Patient registered successfully');
      }
      setShowModal(false);
      setFormData({ name: '', phone: '+593', email: '', cedula: '' });
      setIsEditing(false);
      setCurrentPatientId(null);
      fetchPatients(search, page);
    } catch (err) {
      showToast(err.response?.data?.error || 'Error processing request', 'error');
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

  return (
    <Layout>
      {/* Toast Notification */}
      {toast && (
        <div className={`toast animate-in slide-in-from-bottom-5 fade-in duration-300
          ${toast.type === 'success' ? 'bg-[#10b981] shadow-[#10b981]/30' : 'bg-red-500 shadow-red-500/30'}
        `}>
          {toast.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          <span className="text-sm shadow-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-auto hover:opacity-75 transition-opacity">
            <X size={18} />
          </button>
        </div>
      )}

      <div className="page-shell">
        <header className="page-header">
          <div>
            <h2 className="text-3xl font-black text-secondary tracking-tight">My Patients</h2>
            <p className="text-slate-500 font-medium mt-1">Complete directory of registered patients</p>
          </div>
          <button
            onClick={openCreateModal}
            className="btn-primary flex items-center justify-center gap-2 px-6 py-3 shadow-lg shadow-primary/20 w-full sm:w-auto"
          >
            <Plus size={20} /> New Patient
          </button>
        </header>

        {/* Search Bar */}
        <div className="relative mb-8 group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={20} />
          <input 
            type="text" 
            placeholder="Search by name, ID or phone..."
            value={search}
            onChange={handleSearch}
            className="w-full pl-14 pr-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all shadow-sm text-lg font-medium"
          />
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-20 animate-pulse">
            <span className="text-slate-400 font-semibold text-lg">Loading directory...</span>
          </div>
        ) : (
          <div className="entity-grid">
            {patients.length === 0 ? (
              <div className="col-span-full py-20 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                <Users className="mx-auto text-slate-200 w-16 h-16 mb-4" />
                <p className="text-slate-400 font-bold text-xl">No patients found</p>
                <p className="text-slate-300 mt-1">Try another term or register a new one</p>
              </div>
            ) : (
              patients.map((p) => (
                <div key={p.id} className="bg-white p-6 rounded-3xl border border-slate-100 hover:border-primary hover:shadow-xl hover:shadow-primary/5 transition-all group cursor-pointer">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                      <User size={28} />
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(p);
                      }}
                      className="text-primary transition-colors p-2 hover:bg-primary/5 rounded-xl"
                    >
                      <Edit size={18} />
                    </button>
                  </div>
                  
                  <h3 className="text-xl font-extrabold text-secondary mb-1 truncate">{p.name}</h3>
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
                    <div className="flex -space-x-2">
                      <div className="w-8 h-8 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                        {p.name.charAt(0)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
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
        <div className="modal-overlay">
          <div className="modal-panel max-w-md animate-in zoom-in-95 duration-200">
            <div className="bg-primary p-6 sm:p-8 text-white relative">
              <button
                onClick={() => setShowModal(false)}
                className="absolute right-6 top-6 hover:rotate-90 transition-transform"
              >
                <X size={24} />
              </button>
              <h3 className="text-2xl font-black tracking-tighter">
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
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Patients;
