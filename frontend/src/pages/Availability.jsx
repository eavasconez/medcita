import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../App';
import Layout from '../components/Layout';
import { Clock, Plus, Trash2, Save, CheckCircle2, AlertCircle, X } from 'lucide-react';

const DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

const Availability = () => {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [toast, setToast] = useState(null);
  const { user, token } = useContext(AuthContext);
  const isSpecialRole = user?.role === 'admin' || user?.role === 'secretary';

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchAvailability = async (doctorId) => {
    try {
      setLoading(true);
      const url = `http://localhost:5000/api/availability${doctorId ? `?doctorId=${doctorId}` : ''}`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSchedules(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDoctors = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/admin/medicos?role=doctor', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDoctors(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (isSpecialRole) {
      fetchDoctors();
    } else {
      fetchAvailability();
    }
  }, [isSpecialRole, token]);

  useEffect(() => {
    if (isSpecialRole && selectedDoctorId) {
      fetchAvailability(selectedDoctorId);
    }
  }, [selectedDoctorId, isSpecialRole, token]);

  const addRow = () => {
    setSchedules([...schedules, { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }]);
  };

  const removeRow = (index) => {
    setSchedules(schedules.filter((_, i) => i !== index));
  };

  const updateRow = (index, field, value) => {
    const updated = [...schedules];
    updated[index][field] = field === 'dayOfWeek' ? parseInt(value) : value;
    setSchedules(updated);
  };

  const saveSchedules = async () => {
    try {
      await axios.post('http://localhost:5000/api/availability', {
        schedules,
        doctorId: isSpecialRole ? selectedDoctorId : undefined
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showToast('Schedules updated successfully');
    } catch (err) {
      // Surface the real backend reason (e.g. duplicate day, invalid time
      // range) instead of a generic message the user can't act on.
      showToast(err.response?.data?.error || 'Error saving schedules', 'error');
    }
  };

  return (
    <Layout>
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-8 right-8 z-[200] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-5 fade-in duration-300 text-white font-bold max-w-sm
          ${toast.type === 'success' ? 'bg-[#10b981] shadow-[#10b981]/30' : 'bg-red-500 shadow-red-500/30'}
        `}>
          {toast.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          <span className="text-sm shadow-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-auto hover:opacity-75 transition-opacity">
            <X size={18} />
          </button>
        </div>
      )}

      <div className="page-shell max-w-4xl">
        <header className="page-header mb-12">
          <div>
            <h2 className="text-3xl sm:text-4xl font-black text-secondary tracking-tight">Working Hours</h2>
            <p className="text-slate-500 font-medium mt-1">Define when the clinic is available for appointments</p>
          </div>

          <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
            {isSpecialRole && doctors.length > 0 && (
              <div className="flex flex-col w-full sm:w-auto">
                <label className="form-label">Select Doctor</label>
                <select
                   className="bg-white border border-slate-200 p-3 rounded-2xl font-bold text-secondary outline-none ring-primary/20 focus:ring-4 shadow-sm w-full sm:min-w-[200px]"
                   value={selectedDoctorId}
                   onChange={(e) => setSelectedDoctorId(e.target.value)}
                >
                  <option value="">Select a doctor</option>
                  {doctors.map(dr => (
                    <option key={dr.id} value={dr.id}>Dr. {dr.name}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={saveSchedules}
              className="btn-primary flex items-center justify-center gap-2 px-8 py-4 rounded-3xl w-full sm:w-auto sm:self-end"
            >
              <Save size={20} /> Save Changes
            </button>
          </div>
        </header>

        <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
                <Clock size={20} />
              </div>
              <span className="font-bold text-secondary">Shift Configuration</span>
            </div>
            <button 
              onClick={addRow}
              className="text-primary hover:bg-primary/5 px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-1"
            >
              <Plus size={16} /> Add Block
            </button>
          </div>

          <div className="p-6 space-y-4">
            {schedules.length === 0 ? (
              <p className="text-center py-10 text-slate-400 font-medium italic">
                No schedules configured. The system will allow booking at any time.
              </p>
            ) : (
              schedules.map((s, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row gap-4 items-center bg-slate-50 p-4 rounded-2xl border border-slate-100 group animate-in slide-in-from-right-4">
                  <div className="flex-1 w-full sm:w-auto">
                    <label className="form-label !mb-1">Day of week</label>
                    <select
                      value={s.dayOfWeek}
                      onChange={(e) => updateRow(idx, 'dayOfWeek', e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-primary font-bold text-secondary text-sm"
                    >
                      {DAYS.map((day, i) => (
                        <option key={i} value={i}>{day}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-full sm:w-32">
                    <label className="form-label !mb-1">From</label>
                    <input
                      type="time"
                      value={s.startTime}
                      onChange={(e) => updateRow(idx, 'startTime', e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-primary font-bold text-secondary text-sm"
                    />
                  </div>
                  <div className="w-full sm:w-32">
                    <label className="form-label !mb-1">To</label>
                    <input
                      type="time"
                      value={s.endTime}
                      onChange={(e) => updateRow(idx, 'endTime', e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-primary font-bold text-secondary text-sm"
                    />
                  </div>
                  <div className="pt-0 sm:pt-6 self-end sm:self-auto">
                    <button
                      onClick={() => removeRow(idx)}
                      className="p-2.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Availability;
