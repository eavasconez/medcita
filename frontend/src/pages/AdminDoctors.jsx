import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../App';
import Layout from '../components/Layout';
import { 
  Stethoscope, 
  Plus, 
  Trash2, 
  Edit, 
  Mail, 
  Shield,
  X,
  User,
  Save,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

const AdminDoctors = () => {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState(null);
  const { token } = useContext(AuthContext);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'doctor'
  });

  const fetchDoctors = async () => {
    try {
      setLoading(true);
      const res = await axios.get('http://localhost:5000/api/admin/medicos', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDoctors(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDoctors();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await axios.put(`http://localhost:5000/api/admin/medicos/${editingId}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        await axios.post('http://localhost:5000/api/admin/medicos', formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      setShowModal(false);
      setEditingId(null);
      setFormData({ name: '', email: '', password: '', role: 'doctor' });
      fetchDoctors();
      showToast(`User ${editingId ? 'updated' : 'registered'} successfully`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Error processing user', 'error');
    }
  };

  const handleEdit = (doctor) => {
    setEditingId(doctor.id);
    setFormData({
      name: doctor.name,
      email: doctor.email,
      role: doctor.role,
      password: '' // Keep empty for no change
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this user? All associated data will be lost.')) return;
    try {
      await axios.delete(`http://localhost:5000/api/admin/medicos/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDoctors();
      showToast('User deleted correctly');
    } catch (err) {
      showToast(err.response?.data?.error || 'Error deleting user', 'error');
    }
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
        <header className="page-header mb-10">
          <div>
            <h2 className="text-3xl sm:text-4xl font-black text-secondary tracking-tighter">User Management</h2>
            <p className="text-slate-500 font-medium text-base sm:text-lg mt-1">Platform administrative panel</p>
          </div>
          <button
            onClick={() => {
              setEditingId(null);
              setFormData({ name: '', email: '', password: '', role: 'doctor' });
              setShowModal(true);
            }}
            className="bg-secondary text-white px-8 py-4 rounded-3xl font-black shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 w-full sm:w-auto"
          >
            <Plus size={24} /> Add New User
          </button>
        </header>

        {loading ? (
          <div className="text-center py-20 font-bold text-slate-400">Loading users...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {doctors.map((doc) => (
              <div key={doc.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-2xl transition-all relative group overflow-hidden">
                <div className={`absolute top-0 right-0 w-32 h-32 opacity-5 pointer-events-none -mr-8 -mt-8 rounded-full ${doc.role === 'admin' ? 'bg-orange-500' : 'bg-primary'}`}></div>
                
                <div className="flex justify-between items-start mb-6">
                  <div className={`w-16 h-16 rounded-3xl flex items-center justify-center text-white shadow-lg ${doc.role === 'admin' ? 'bg-orange-500 shadow-orange-500/20' : 'bg-primary shadow-primary/20'}`}>
                    {doc.role === 'admin' ? <Shield size={32} /> : <Stethoscope size={32} />}
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleEdit(doc)}
                      className="p-3 bg-slate-50 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-2xl transition-all"
                    >
                      <Edit size={20} />
                    </button>
                    <button 
                      onClick={() => handleDelete(doc.id)}
                      className="p-3 bg-slate-50 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>

                <h3 className="text-2xl font-black text-secondary mb-1 truncate">{doc.name}</h3>
                <p className="flex items-center gap-2 text-slate-400 font-bold text-sm mb-6">
                  <Mail size={16} /> {doc.email}
                </p>

                <div className="flex items-center justify-between pt-6 border-t border-slate-50">
                  <div>
                    <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${doc.role === 'admin' ? 'bg-orange-100 text-orange-600' : doc.role === 'secretary' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                      {doc.role}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-300 uppercase font-black tracking-widest leading-none">Total Appointments</p>
                    <p className="text-xl font-black text-secondary mt-1">{doc._count?.appointments || 0}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal CRUD Médico */}
      {showModal && (
        <div className="modal-overlay bg-secondary/60">
          <div className="modal-panel max-w-md rounded-[3rem] animate-in zoom-in-95 duration-200">
            <div className="bg-secondary p-6 sm:p-10 text-white relative">
              <button
                onClick={() => setShowModal(false)}
                className="absolute right-6 top-6 sm:right-8 sm:top-8 hover:rotate-90 transition-transform"
              >
                <X size={24} />
              </button>
              <h3 className="text-3xl font-black tracking-tighter">{editingId ? 'Edit User' : 'New User'}</h3>
              <p className="text-white/40 font-medium mt-1">Configure system access</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 sm:p-10 space-y-5">
              <div>
                <label className="form-label">Full Name</label>
                <input
                  required
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-secondary/10 focus:border-secondary transition-all font-bold text-secondary"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="Dr. John Doe"
                />
              </div>

              <div>
                <label className="form-label">Email (Usuario)</label>
                <input
                  required
                  type="email"
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-secondary/10 focus:border-secondary transition-all font-bold text-secondary"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  placeholder="doctor@medcita.ec"
                />
              </div>

              <div>
                <label className="form-label">
                  {editingId ? 'Password (leave blank to keep)' : 'Initial Password'}
                </label>
                <input
                  type="password"
                  required={!editingId}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-secondary/10 focus:border-secondary transition-all font-bold text-secondary"
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="form-label">User Role</label>
                <select
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-secondary/10 focus:border-secondary transition-all font-bold text-secondary"
                  value={formData.role}
                  onChange={(e) => setFormData({...formData, role: e.target.value})}
                >
                  <option value="doctor">Medical Doctor</option>
                  <option value="admin">Platform Administrator</option>
                  <option value="secretary">Secretary / Assistant</option>
                </select>
              </div>
              
              <div className="flex gap-4 pt-4">
                <button 
                  type="submit"
                  className="w-full py-5 bg-secondary text-white font-black rounded-2xl shadow-xl hover:shadow-secondary/20 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest text-sm flex items-center justify-center gap-2"
                >
                  <Save size={20} />
                  {editingId ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default AdminDoctors;
