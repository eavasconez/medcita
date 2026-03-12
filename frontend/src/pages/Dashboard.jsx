import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../App';
import axios from 'axios';
import { Plus, LogOut, Calendar, Clock, User, Phone, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const Dashboard = () => {
  const { user, token, logout } = useContext(AuthContext);
  const [appointments, setAppointments] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [formData, setFormData] = useState({
    patientName: '',
    patientPhone: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    time: '09:00'
  });

  const fetchAppointments = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/appointments', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAppointments(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAppointments();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:5000/api/appointments', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowModal(false);
      fetchAppointments();
      setFormData({ ...formData, patientName: '', patientPhone: '' });
      alert('¡Cita agendada y WhatsApp enviado!');
    } catch (err) {
      alert('Error al agendar cita');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <Calendar className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-secondary">MedCita Panel</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:block text-right">
            <p className="text-sm font-semibold text-secondary">{user?.name}</p>
            <p className="text-xs text-slate-400">{user?.email}</p>
          </div>
          <button 
            onClick={logout}
            className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto p-6 md:p-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold text-secondary">Mi Agenda</h2>
            <p className="text-slate-500">Gestiona tus pacientes y citas</p>
          </div>
          <button 
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg font-semibold shadow-md active:scale-95 transition-all"
          >
            <Plus className="w-5 h-5" /> Nueva Cita
          </button>
        </div>

        {loading ? (
          <div className="text-center py-20">Cargando citas...</div>
        ) : (
          <div className="grid gap-4">
            {appointments.length === 0 ? (
              <div className="bg-white p-10 rounded-xl text-center border border-dashed border-slate-200">
                <p className="text-slate-400">No tienes citas programadas.</p>
              </div>
            ) : (
              appointments.map((apt) => (
                <div key={apt.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-primary transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary bg-opacity-10 rounded-full flex items-center justify-center">
                      <User className="text-primary w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-secondary">{apt.Patient.name}</h3>
                      <p className="text-sm text-slate-400 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {apt.Patient.phone}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-8">
                    <div className="flex items-center gap-2 text-slate-600">
                      <Calendar className="w-4 h-4 text-primary" />
                      <span className="text-sm">{format(new Date(apt.date + 'T12:00:00'), 'dd MMM, yyyy', { locale: es })}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                      <Clock className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">{apt.time}</span>
                    </div>
                    <div className="hidden md:flex bg-green-50 text-green-600 px-3 py-1 rounded-full text-xs font-semibold items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Confirmado
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Modal Nueva Cita */}
      {showModal && (
        <div className="fixed inset-0 bg-secondary bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-primary p-6 text-white">
              <h3 className="text-xl font-bold">Agendar Nueva Cita</h3>
              <p className="text-primary text-opacity-80 text-sm">Se enviará un WhatsApp automático</p>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre del Paciente</label>
                <input
                  required
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-primary"
                  value={formData.patientName}
                  onChange={(e) => setFormData({...formData, patientName: e.target.value})}
                  placeholder="Ej: Daniel Noboa"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp (con código de país)</label>
                <input
                  required
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-primary"
                  value={formData.patientPhone}
                  onChange={(e) => setFormData({...formData, patientPhone: e.target.value})}
                  placeholder="Ej: +593987654321"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fecha</label>
                  <input
                    type="date"
                    required
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-primary"
                    value={formData.date}
                    onChange={(e) => setFormData({...formData, date: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hora</label>
                  <input
                    type="time"
                    required
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-primary"
                    value={formData.time}
                    onChange={(e) => setFormData({...formData, time: e.target.value})}
                  />
                </div>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2 text-slate-500 font-semibold hover:bg-slate-50 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-2 bg-primary text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all"
                >
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
