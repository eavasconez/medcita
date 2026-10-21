import React, { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import Layout from '../components/Layout';
import LoadError from '../components/LoadError';
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
  AlertCircle,
  Send,
  RefreshCw,
  Clock
} from 'lucide-react';

const AdminDoctors = () => {
  const [doctors, setDoctors] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState(null);
  const { token, user } = useContext(AuthContext);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'doctor'
  });

  const fetchDoctors = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const headers = { Authorization: `Bearer ${token}` };
      const [doctorsRes, invitationsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/admin/doctors`, { headers }),
        axios.get(`${API_BASE_URL}/api/admin/invitations`, { headers })
      ]);
      setDoctors(doctorsRes.data);
      setInvitations(invitationsRes.data);
    } catch (err) {
      console.error(err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDoctors();
  }, [fetchDoctors]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const headers = { Authorization: `Bearer ${token}` };
      let message = 'User updated successfully';
      if (editingId) {
        await axios.put(`${API_BASE_URL}/api/admin/doctors/${editingId}`, formData, { headers });
      } else {
        // Nobody sets another person's password: they get an email to choose their own
        const res = await axios.post(`${API_BASE_URL}/api/admin/doctors`, formData, { headers });
        message = res.data.delivered
          ? `Invitation sent to ${formData.email}`
          : 'Invitation saved, but the email could not be delivered. Use Resend to try again.';
      }
      setShowModal(false);
      setEditingId(null);
      setFormData({ name: '', email: '', role: 'doctor' });
      fetchDoctors();
      showToast(message);
    } catch (err) {
      showToast(err.response?.data?.error || 'Error processing user', 'error');
    }
  };

  const handleEdit = (doctor) => {
    setEditingId(doctor.id);
    setFormData({
      name: doctor.name,
      email: doctor.email,
      role: doctor.role
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this user? All associated data will be lost.')) return;
    try {
      await axios.delete(`${API_BASE_URL}/api/admin/doctors/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDoctors();
      showToast('User deleted correctly');
    } catch (err) {
      showToast(err.response?.data?.error || 'Error deleting user', 'error');
    }
  };

  const handleResend = async (invitation) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/api/admin/invitations/${invitation.id}/resend`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDoctors();
      if (res.data.delivered) showToast(`Invitation sent again to ${invitation.email}`);
      else showToast('The invitation was renewed, but the email could not be delivered', 'error');
    } catch (err) {
      showToast(err.response?.data?.error || 'Error resending the invitation', 'error');
    }
  };

  const handleCancelInvitation = async (invitation) => {
    if (!window.confirm(`Cancel the invitation for ${invitation.email}? Their link will stop working.`)) return;
    try {
      await axios.delete(`${API_BASE_URL}/api/admin/invitations/${invitation.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDoctors();
      showToast('Invitation cancelled');
    } catch (err) {
      showToast(err.response?.data?.error || 'Error cancelling the invitation', 'error');
    }
  };

  const daysLeft = (invitation) => Math.max(0, Math.ceil((new Date(invitation.expiresAt) - Date.now()) / 86400000));

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
            <p className="text-slate-500 font-medium text-base sm:text-lg mt-1">
              {user?.clinic?.name ? <>People who work at <span className="font-black text-secondary">{user.clinic.name}</span></> : 'Clinic administrative panel'}
            </p>
          </div>
          <button
            onClick={() => {
              setEditingId(null);
              setFormData({ name: '', email: '', role: 'doctor' });
              setShowModal(true);
            }}
            className="bg-secondary text-white px-8 py-4 rounded-3xl font-black shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 w-full sm:w-auto"
          >
            <Plus size={24} /> Invite User
          </button>
        </header>

        {loading ? (
          <div className="text-center py-20 font-bold text-slate-400">Loading users...</div>
        ) : loadError ? (
          <LoadError message="We couldn't load the users." onRetry={fetchDoctors} />
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

        {!loading && !loadError && invitations.length > 0 && (
          <section className="mt-14" aria-labelledby="pending-invitations">
            <h3 id="pending-invitations" className="text-2xl font-black text-secondary tracking-tight">Pending invitations</h3>
            <p className="text-slate-500 font-medium mt-1 mb-6">They become users when the person opens the link in their email and chooses a password.</p>
            <ul className="space-y-3">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-secondary truncate">{invitation.name}</p>
                    <p className="flex items-center gap-2 text-slate-400 font-bold text-sm truncate"><Mail size={14} /> {invitation.email}</p>
                  </div>
                  <span className={`self-start sm:self-center px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${invitation.role === 'admin' ? 'bg-orange-100 text-orange-600' : invitation.role === 'secretary' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                    {invitation.role}
                  </span>
                  <span className={`flex items-center gap-1.5 text-sm font-bold ${invitation.expired ? 'text-red-500' : 'text-slate-400'}`}>
                    <Clock size={16} />
                    {invitation.expired ? 'Expired' : `Expires in ${daysLeft(invitation)} day${daysLeft(invitation) === 1 ? '' : 's'}`}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleResend(invitation)}
                      className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 text-slate-500 hover:text-primary hover:bg-primary/5 rounded-2xl font-bold text-sm transition-all"
                    >
                      <RefreshCw size={16} /> Resend
                    </button>
                    <button
                      onClick={() => handleCancelInvitation(invitation)}
                      className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-2xl font-bold text-sm transition-all"
                    >
                      <X size={16} /> Cancel
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Modal: invite a person, or edit an account */}
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
              <h3 className="text-3xl font-black tracking-tighter">{editingId ? 'Edit User' : 'Invite User'}</h3>
              <p className="text-white/40 font-medium mt-1">
                {editingId ? 'Configure system access' : `They will get an email to join ${user?.clinic?.name || 'your clinic'} and choose their own password`}
              </p>
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
                <label className="form-label">User Role</label>
                <select
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-secondary/10 focus:border-secondary transition-all font-bold text-secondary"
                  value={formData.role}
                  onChange={(e) => setFormData({...formData, role: e.target.value})}
                >
                  <option value="doctor">Medical Doctor</option>
                  <option value="admin">Clinic Administrator</option>
                  <option value="secretary">Secretary / Assistant</option>
                </select>
              </div>
              
              <div className="flex gap-4 pt-4">
                <button 
                  type="submit"
                  className="w-full py-5 bg-secondary text-white font-black rounded-2xl shadow-xl hover:shadow-secondary/20 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest text-sm flex items-center justify-center gap-2"
                >
                  {editingId ? <Save size={20} /> : <Send size={20} />}
                  {editingId ? 'Save Changes' : 'Send Invitation'}
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
