import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../App';
import Layout from '../components/Layout';
import { Clock, Plus, Trash2, Save } from 'lucide-react';

const DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

const Availability = () => {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const { user, token } = useContext(AuthContext);
  const isSpecialRole = user?.role === 'admin' || user?.role === 'secretary';

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
      alert('Schedules updated successfully');
    } catch (err) {
      alert('Error saving schedules');
    }
  };

  return (
    <Layout>
      <div className="p-8 max-w-4xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
          <div>
            <h2 className="text-4xl font-black text-secondary tracking-tight">Working Hours</h2>
            <p className="text-slate-500 font-medium mt-1">Define when the clinic is available for appointments</p>
          </div>
          
          <div className="flex items-center gap-4 w-full md:w-auto">
            {isSpecialRole && doctors.length > 0 && (
              <div className="flex flex-col">
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 ml-1 tracking-widest">Select Doctor</label>
                <select 
                   className="bg-white border border-slate-200 p-3 rounded-2xl font-bold text-secondary outline-none ring-primary/20 focus:ring-4 shadow-sm min-w-[200px]"
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
              className="flex items-center gap-2 bg-primary text-white px-8 py-4 rounded-3xl font-black shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all self-end"
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
                <div key={idx} className="flex flex-col md:flex-row gap-4 items-center bg-slate-50 p-4 rounded-2xl border border-slate-100 group animate-in slide-in-from-right-4">
                  <div className="flex-1 w-full md:w-auto">
                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1 ml-1 tracking-widest">Day of week</label>
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
                  <div className="w-full md:w-32">
                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1 ml-1 tracking-widest">From</label>
                    <input
                      type="time"
                      value={s.startTime}
                      onChange={(e) => updateRow(idx, 'startTime', e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-primary font-bold text-secondary text-sm"
                    />
                  </div>
                  <div className="w-full md:w-32">
                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1 ml-1 tracking-widest">To</label>
                    <input
                      type="time"
                      value={s.endTime}
                      onChange={(e) => updateRow(idx, 'endTime', e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-primary font-bold text-secondary text-sm"
                    />
                  </div>
                  <div className="pt-4 md:pt-6">
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
