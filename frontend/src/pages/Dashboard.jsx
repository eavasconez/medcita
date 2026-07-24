import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { AuthContext } from '../App';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import Layout from '../components/Layout';
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import esES from 'date-fns/locale/es';
import enUS from 'date-fns/locale/en-US';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';

const DnDCalendar = withDragAndDrop(BigCalendar);
import { 
  Plus, 
  Users, 
  Calendar as CalendarIcon, 
  TrendingUp, 
  MoreHorizontal,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  Search,
  User
} from 'lucide-react';
import { debounce } from 'lodash';

const locales = {
  'en-US': enUS,
  'en': enUS,
  'es': esES
};

// Distinct from the status colors (#10b981/#0ea5e9/#f59e0b) used on the
// event background, so a doctor's identifying stripe never reads as a status.
const DOCTOR_COLOR_PALETTE = ['#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e', '#6366f1', '#84cc16', '#06b6d4', '#d946ef'];

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});
const Dashboard = () => {
  const [appointments, setAppointments] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [stats, setStats] = useState({ totalAppointments: 0, newPatients: 0, effectiveness: '—' });
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState(() => (window.innerWidth < 768 ? 'day' : 'week'));
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // `view` is controlled, so it won't follow `isMobile` on its own when the
  // viewport crosses the breakpoint after mount (e.g. resize or rotation) -
  // force it back to day view rather than leaving an unreadable week/month grid.
  useEffect(() => {
    if (isMobile && (view === 'week' || view === 'month')) {
      setView('day');
    }
  }, [isMobile]);

  const { user, token } = useContext(AuthContext);
  const isSpecialRole = user?.role === 'admin' || user?.role === 'secretary';

  // Add new states for Calendly logic
  const [modalStep, setModalStep] = useState(1); // 1: Patient, 2: Date/Time, 3: Confirm
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [doctors, setDoctors] = useState([]);
  // Maps doctorId -> a stable color, assigned by list order, so the combined
  // (no-doctor-selected) calendar can visually distinguish whose appointment
  // is whose without relying on the status color (which means something else).
  const doctorColorMap = useMemo(() => {
    return doctors.reduce((acc, doc, i) => {
      acc[doc.id] = DOCTOR_COLOR_PALETTE[i % DOCTOR_COLOR_PALETTE.length];
      return acc;
    }, {});
  }, [doctors]);
  const [patients, setPatients] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Appointment list filters (status + patient)
  const [statusFilter, setStatusFilter] = useState('');
  const [patientFilterId, setPatientFilterId] = useState('');
  const [patientFilterName, setPatientFilterName] = useState('');
  const [patientFilterQuery, setPatientFilterQuery] = useState('');
  const [patientFilterResults, setPatientFilterResults] = useState([]);

  // Form state
  const [formData, setFormData] = useState({
    doctorId: '', // Initialized below or in useEffect
    patientId: '', // To link existing patients
    patientName: '',
    patientPhone: '+593',
    patientEmail: '',
    patientCedula: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    time: '',
    notes: ''
  });
  // True while an admin/secretary is viewing the clinic-wide calendar (no
  // doctor picked yet) - the view where events from multiple doctors overlap
  // and need the per-doctor color stripe/legend to stay distinguishable.
  const showCombinedView = isSpecialRole && !formData.doctorId;

  // Ensure doctorId is set once user is available
  useEffect(() => {
    if (user?.id && !formData.doctorId) {
      setFormData(prev => ({
        ...prev,
        doctorId: isSpecialRole ? '' : user.id
      }));
    }
  }, [user, isSpecialRole]);

  const [weeklyAvailability, setWeeklyAvailability] = useState([]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Uses axios' `params` (not string interpolation) so a query containing
  // &/#/+ doesn't get mangled, and cancels any still-in-flight previous
  // request so a slower older response can't overwrite fresher results.
  const patientPickerAbortRef = useRef(null);
  const fetchPatients = async (query = '') => {
    patientPickerAbortRef.current?.abort();
    const controller = new AbortController();
    patientPickerAbortRef.current = controller;
    try {
      const res = await axios.get(`${API_BASE_URL}/api/patients`, {
        params: { search: query },
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      setPatients(res.data.patients);
    } catch (err) {
      if (err.code !== 'ERR_CANCELED') console.error(err);
    }
  };

  const debouncedSearch = debounce(fetchPatients, 300);

  useEffect(() => {
    if (showModal && modalStep === 1) {
      fetchPatients();
    }
  }, [showModal, modalStep]);

  const fetchSlots = async (date, doctorId) => {
    if (!doctorId) return;
    try {
      setLoadingSlots(true);
      const res = await axios.get(`${API_BASE_URL}/api/availability/slots?date=${date}&doctorId=${doctorId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAvailableSlots(res.data);
    } catch (err) {
      showToast('Error loading availability', 'error');
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (showModal && formData.date && formData.doctorId) {
      fetchSlots(formData.date, formData.doctorId);
    }
  }, [formData.date, formData.doctorId, showModal]);

  const selectPatient = (p) => {
    setFormData({
      ...formData,
      patientId: p.id,
      patientName: p.name,
      patientPhone: p.phone,
      patientEmail: p.email || '',
      patientCedula: p.cedula || ''
    });
    setModalStep(2);
  };

  const skipPatientStep = () => {
    setModalStep(2);
  };

  const fetchDoctors = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/admin/medicos?role=doctor`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDoctors(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (isSpecialRole && token) {
      fetchDoctors();
    }
  }, [isSpecialRole, token]);

  const handleSelectSlot = ({ start }) => {
    if (start < new Date()) {
      setToast({ message: 'You cannot schedule appointments in the past', type: 'error' });
      return;
    }

    const selectedDate = format(start, 'yyyy-MM-dd');
    const selectedTime = format(start, 'HH:mm');

    setFormData(prev => ({
      ...prev,
      // Reset patient fields so a slot click always starts a fresh appointment
      // (otherwise a previously selected/created patient stays pre-loaded)
      patientId: '',
      patientName: '',
      patientPhone: '+593',
      patientEmail: '',
      patientCedula: '',
      notes: '',
      date: selectedDate,
      time: selectedTime === '00:00' ? '' : selectedTime,
      doctorId: prev.doctorId || (isSpecialRole && doctors.length > 0 ? doctors[0].id : prev.doctorId)
    }));

    setModalStep(1);
    setShowModal(true);
  };

  useEffect(() => {
    const fetchAvailability = async () => {
      if (!formData.doctorId) return;
      try {
        const res = await axios.get(`${API_BASE_URL}/api/availability?doctorId=${formData.doctorId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setWeeklyAvailability(res.data);
      } catch (err) {
        console.error(err);
      }
    };

    if (isSpecialRole && showModal && doctors.length === 0) {
      fetchDoctors();
    }
    fetchAvailability();
  }, [isSpecialRole, showModal, token, formData.doctorId]);

  const computeStats = (data) => {
    const positive = data.filter(a => a.status === 'confirmed' || a.status === 'completed').length;
    const effectiveness = data.length > 0
      ? `${Math.round((positive / data.length) * 100)}%`
      : '—';
    return {
      totalAppointments: data.length,
      newPatients: new Set(data.map(a => a.patientId)).size,
      effectiveness
    };
  };

  // Calendar list: reflects the active status/patient filters.
  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (formData.doctorId) params.set('doctorId', formData.doctorId);
      if (statusFilter) params.set('status', statusFilter);
      if (patientFilterId) params.set('patientId', patientFilterId);
      const queryString = params.toString();

      const res = await axios.get(`${API_BASE_URL}/api/appointments${queryString ? `?${queryString}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAppointments(res.data);

      // With no calendar filter active, this response already IS the
      // selected doctor's full appointment set - reuse it for the KPIs
      // instead of letting fetchStats fire an identical second request.
      if (formData.doctorId && !statusFilter && !patientFilterId) {
        setStats(computeStats(res.data));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Headline KPIs: always computed from the selected doctor's full appointment
  // set, NOT the filtered calendar view — otherwise filtering by e.g.
  // 'confirmed' would show 100% effectiveness and 'scheduled' would show 0%.
  // Scoped strictly by doctorId so the numbers stay stable regardless of the
  // active filters.
  const fetchStats = async () => {
    // Without a selected doctor (admin/secretary before picking one) the API
    // would return clinic-wide aggregates; show a neutral placeholder instead
    // until a doctor is chosen, matching the "select a doctor" empty state.
    if (!formData.doctorId) {
      setStats({ totalAppointments: 0, newPatients: 0, effectiveness: '—' });
      return;
    }
    // No filter active: fetchAppointments' effect runs alongside this one and
    // already computes stats from the same (unfiltered) response - skip the
    // duplicate network round-trip.
    if (!statusFilter && !patientFilterId) return;
    try {
      const res = await axios.get(`${API_BASE_URL}/api/appointments?doctorId=${formData.doctorId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(computeStats(res.data));
    } catch (err) {
      console.error(err);
    }
  };

  const patientFilterAbortRef = useRef(null);
  const searchFilterPatients = async (query) => {
    if (!query) {
      setPatientFilterResults([]);
      return;
    }
    patientFilterAbortRef.current?.abort();
    const controller = new AbortController();
    patientFilterAbortRef.current = controller;
    try {
      const res = await axios.get(`${API_BASE_URL}/api/patients`, {
        params: { search: query },
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      setPatientFilterResults(res.data.patients);
    } catch (err) {
      if (err.code !== 'ERR_CANCELED') console.error(err);
    }
  };

  const debouncedFilterSearch = debounce(searchFilterPatients, 300);

  const clearPatientFilter = () => {
    setPatientFilterId('');
    setPatientFilterName('');
    setPatientFilterQuery('');
    setPatientFilterResults([]);
  };

  useEffect(() => {
    fetchAppointments();
  }, [token, formData.doctorId, statusFilter, patientFilterId]);

  // KPIs only depend on the selected doctor, not the calendar filters.
  useEffect(() => {
    fetchStats();
  }, [token, formData.doctorId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE_URL}/api/appointments`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowModal(false);
      showToast('Appointment scheduled! Notifications are being sent.', 'success');
      fetchAppointments();
      fetchStats();
      setModalStep(1);
    } catch (err) {
      showToast(err.response?.data?.error || 'Error al agendar cita', 'error');
    }
  };

  const handleEventDrop = async ({ event, start }) => {
    const aptId = event.resource.id;
    const newDate = format(start, 'yyyy-MM-dd');
    const newTime = format(start, 'HH:mm');
    
    // Optimistic update
    const updatedApts = appointments.map(a => 
      a.id === aptId ? { ...a, date: newDate, time: newTime } : a
    );
    setAppointments(updatedApts);

    try {
      await axios.put(`${API_BASE_URL}/api/appointments/${aptId}`, {
        date: newDate,
        time: newTime
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setToast({ message: 'Appointment rescheduled successfully', type: 'success' });
      fetchAppointments(); // Refresh to be safe
      fetchStats();
    } catch (err) {
      setToast({ message: 'Error rescheduling appointment', type: 'error' });
      fetchAppointments(); // Rollback
    }
  };

  const handleSelectEvent = (event) => {
    setSelectedEvent(event.resource);
    setShowEditModal(true);
  };

  const handleUpdateStatus = async (id, status) => {
    try {
      // Optimistic update
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a));
      
      await axios.put(`${API_BASE_URL}/api/appointments/${id}`, { status }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setToast({ message: `Appointment ${status === 'confirmed' ? 'confirmed' : 'updated'}`, type: 'success' });
      setShowEditModal(false);
      fetchAppointments();
      fetchStats();
    } catch (err) {
      setToast({ message: 'Error updating appointment', type: 'error' });
      fetchAppointments();
    }
  };

  const handleDeleteAppointment = async (id) => {
    if (!window.confirm('Are you sure you want to cancel this appointment?')) return;
    try {
      await axios.delete(`${API_BASE_URL}/api/appointments/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setToast({ message: 'Appointment cancelled', type: 'success' });
      setShowEditModal(false);
      fetchAppointments();
      fetchStats();
    } catch (err) {
      setToast({ message: 'Error cancelling appointment', type: 'error' });
    }
  };

  const handleOpenModal = () => {
    // Determine the initial doctor ID
    let initialDoctorId = formData.doctorId;
    if (!initialDoctorId) {
      initialDoctorId = isSpecialRole ? (doctors.length > 0 ? doctors[0].id : '') : user?.id;
    }

    setFormData(prev => ({
      ...prev,
      patientId: '',
      patientName: '', 
      patientPhone: '+593', 
      patientEmail: '',
      patientCedula: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      time: '',
      notes: '',
      doctorId: initialDoctorId
    }));
    setModalStep(1);
    setShowModal(true);
  };

  // react-big-calendar renders event content through the `components.event`
  // prop - NOT through anything returned from eventPropGetter (that getter's
  // return is only used for `className`/`style` on the event wrapper). This
  // is the actual hook for adding the per-doctor identifier to the combined
  // (no-doctor-selected) calendar view.
  const EventContent = ({ event, title }) => (
    <span className="flex items-center gap-1 truncate">
      {showCombinedView && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: doctorColorMap[event.resource?.doctorId] || '#94a3b8' }}
        ></span>
      )}
      <span className="truncate">
        {title}
        {showCombinedView && event.resource?.doctor?.name ? ` · ${event.resource.doctor.name}` : ''}
      </span>
    </span>
  );

  const calendarEvents = appointments.map(apt => {
    const start = new Date(`${apt.date}T${apt.time}`);
    const end = new Date(start.getTime() + 30 * 60000); // 30 min duration
    return {
      id: apt.id,
      title: apt.Patient.name,
      start,
      end,
      resource: apt
    };
  });

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
        {/* Header with Stats */}
        <header className="page-header mb-10">
          <div>
            <h2 className="text-3xl sm:text-4xl font-black text-secondary tracking-tighter">
              {isSpecialRole ? 'Administrative Center' : 'My Schedule'}
            </h2>
            <p className="text-slate-500 font-medium text-base sm:text-lg">
              {isSpecialRole ? 'Manage clinical calendars and patients' : 'Welcome to MedCita Control Center'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {isSpecialRole && doctors.length > 0 && (
              <div className="flex flex-col">
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 ml-1 tracking-widest">Select Doctor</label>
                <select 
                  className="bg-white border border-slate-200 p-3 rounded-2xl font-bold text-secondary outline-none ring-primary/20 focus:ring-4 shadow-sm min-w-[200px]"
                  value={formData.doctorId}
                  onChange={(e) => setFormData(prev => ({ ...prev, doctorId: e.target.value }))}
                >
                  <option value="">Select a doctor</option>
                  {doctors.map(dr => (
                    // Doctor names already carry their own title (e.g. "Dr. Santiago
                    // Pérez", "Dra. Camila Torres") - only prepend "Dr." for names
                    // that don't, instead of always doubling it up.
                    <option key={dr.id} value={dr.id}>{/^dra?\.?\s/i.test(dr.name) ? dr.name : `Dr. ${dr.name}`}</option>
                  ))}
                </select>
              </div>
            )}
            <button 
              onClick={handleOpenModal}
              className="bg-primary hover:bg-opacity-90 text-white px-8 py-4 rounded-3xl font-black shadow-xl shadow-primary/20 flex items-center gap-3 active:scale-95 transition-all text-lg self-end"
            >
              <Plus size={24} /> New Appointment
            </button>
          </div>
        </header>

        {isSpecialRole && !formData.doctorId && (
          <div className="bg-blue-50 p-10 rounded-[2.5rem] border border-blue-100 flex flex-col items-center justify-center text-center mb-8 animate-in fade-in zoom-in-95 duration-500">
            <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center text-primary mb-6">
              <Search size={40} />
            </div>
            <h3 className="text-2xl font-black text-secondary mb-2">Ready to manage?</h3>
            <p className="text-slate-500 font-medium max-w-sm">Please select a doctor to load their schedule, stats and availability.</p>
          </div>
        )}

        {/* Header with Stats and Legend */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-8">
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="card flex items-center gap-6 group hover:scale-[1.02] transition-all cursor-default">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors duration-500">
              <CalendarIcon size={32} />
            </div>
            <div>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mb-1">Total Appointments</p>
              <h3 className="text-4xl font-black text-secondary">{stats.totalAppointments}</h3>
            </div>
          </div>

          <div className="card flex items-center gap-6 group hover:scale-[1.02] transition-all cursor-default">
            <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center text-green-500 group-hover:bg-green-500 group-hover:text-white transition-colors duration-500">
              <Users size={32} />
            </div>
            <div>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mb-1">Total Patients</p>
              <h3 className="text-4xl font-black text-secondary">{stats.newPatients}</h3>
            </div>
          </div>

          <div className="card flex items-center gap-6 group hover:scale-[1.02] transition-all cursor-default">
            <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-colors duration-500">
              <TrendingUp size={32} />
            </div>
            <div>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mb-1">Effectiveness</p>
              <h3 className="text-4xl font-black text-secondary">{stats.effectiveness}</h3>
            </div>
          </div>
        </div>

        {/* Legend Card */}
        <div className="card flex flex-col justify-center">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Legend</p>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#10b981]"></div>
              <span className="text-xs font-bold text-secondary">Confirmed</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#0ea5e9]"></div>
              <span className="text-xs font-bold text-secondary">Scheduled</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#f59e0b]"></div>
              <span className="text-xs font-bold text-secondary">Pending</span>
            </div>
          </div>

          {showCombinedView && doctors.length > 0 && (
            <>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-5 mb-4">Doctors</p>
              <div className="space-y-3">
                {doctors.map(doc => (
                  <div key={doc.id} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: doctorColorMap[doc.id] }}></div>
                    <span className="text-xs font-bold text-secondary truncate">{doc.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Appointment Filters */}
      <div className="filter-bar mb-8">
        <div className="flex items-center gap-2 text-slate-400 font-black text-[10px] uppercase tracking-widest">
          <Search size={16} />
          Filters
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="p-3 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm text-secondary outline-none focus:ring-4 focus:ring-primary/10 w-full sm:w-auto"
        >
          <option value="">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="scheduled">Scheduled</option>
          <option value="pending_approval">Pending</option>
        </select>

        <div className="relative w-full sm:w-auto">
          {patientFilterId ? (
            <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-2xl w-full sm:w-auto">
              <span className="font-bold text-sm text-primary">{patientFilterName}</span>
              <button onClick={clearPatientFilter} className="text-primary/60 hover:text-primary transition-colors ml-auto sm:ml-0">
                <X size={16} />
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Filter by patient..."
                value={patientFilterQuery}
                onChange={(e) => {
                  setPatientFilterQuery(e.target.value);
                  debouncedFilterSearch(e.target.value);
                }}
                className="p-3 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-primary/10 w-full sm:w-56"
              />
              {patientFilterResults.length > 0 && (
                <div className="absolute z-20 mt-2 w-full sm:w-56 bg-white rounded-2xl shadow-2xl border border-slate-100 max-h-48 overflow-y-auto">
                  {patientFilterResults.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setPatientFilterId(p.id);
                        setPatientFilterName(p.name);
                        setPatientFilterResults([]);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-primary/5 text-sm font-bold text-secondary transition-colors"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {(statusFilter || patientFilterId) && (
          <button
            onClick={() => { setStatusFilter(''); clearPatientFilter(); }}
            className="text-[10px] font-black text-slate-400 hover:text-red-400 uppercase tracking-widest transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

        {/* Calendar Section */}
        <div className="bg-white p-4 sm:p-6 lg:p-8 rounded-[2.5rem] border border-slate-100 shadow-2xl relative min-h-[600px]">
          {loading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center animate-in fade-in duration-300">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-slate-400 font-black uppercase tracking-widest text-xs">Syncing agenda...</p>
            </div>
          )}

          <div className="overflow-x-auto">
          <div className={view === 'week' || view === 'month' ? 'min-w-[640px]' : ''}>
          <DnDCalendar
            localizer={localizer}
            events={calendarEvents}
            startAccessor="start"
            endAccessor="end"
            date={date}
            view={view}
            onNavigate={(newDate) => setDate(newDate)}
            onView={(newView) => setView(newView)}
            selectable
            resizable={false}
            draggableAccessor={() => true}
            onSelectSlot={handleSelectSlot}
            onSelectEvent={handleSelectEvent}
            onEventDrop={handleEventDrop}
            style={{ height: isMobile ? 500 : 700 }}
            messages={{
              next: "Next",
              previous: "Previous",
              today: "Today",
              month: "Month",
              week: "Week",
              day: "Day",
              agenda: "Agenda",
              allDay: "All day",
              noEventsInRange: "No appointments in this range"
            }}
            culture="en-US"
            components={{ event: EventContent }}
              eventPropGetter={(event) => {
                const status = event.resource?.status;
                let backgroundColor = '#1e293b'; // Default secondary
                
                if (status === 'confirmed') backgroundColor = '#10b981'; // Green
                if (status === 'pending_approval') backgroundColor = '#f59e0b'; // Orange
                if (status === 'scheduled') backgroundColor = '#0ea5e9'; // Blue

                const startStr = format(event.start, 'HH:mm');
                
                const isPast = event.start < new Date();
                
                return {
                  className: `!rounded-xl !p-2 !border-none !shadow-md hover:scale-[1.02] transition-all !cursor-pointer ${isPast ? 'opacity-50 grayscale-[0.3]' : ''}`,
                  style: { 
                    backgroundColor,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    minHeight: '30px'
                  },
                  children: (
                    <div className="flex flex-col overflow-hidden text-white">
                      <span className="font-black text-[10px] truncate leading-tight">{event.title}</span>
                      <span className="text-[8px] opacity-80 font-bold">{startStr}</span>
                    </div>
                  )
                };
              }}
              slotPropGetter={(date) => {
                const day = getDay(date);
                const hour = format(date, 'HH:mm');
                const isPast = date < new Date();
                
                const isWorking = weeklyAvailability.some(a => 
                  a.dayOfWeek === day && 
                  hour >= a.startTime && 
                  hour < a.endTime
                );

                if (isPast) {
                  return {
                    className: "!bg-slate-100/50 !cursor-not-allowed opacity-60"
                  };
                }

                if (!isWorking) {
                  return {
                    className: "!bg-slate-50/50 opacity-30"
                  };
                }
                
                return {
                  className: "hover:!bg-green-50 transition-colors cursor-crosshair group relative",
                };
              }}
            />
          </div>
          </div>
        </div>
      </div>      {showModal && (
        <div className="modal-overlay">
          <div className="modal-panel max-w-3xl rounded-[3rem] animate-in zoom-in-95 duration-200 flex flex-col md:flex-row h-auto max-h-[95vh]">
            
            {/* Sidebar Info (Calendly Style) */}
            <div className="bg-slate-50 md:w-72 p-6 sm:p-10 border-r border-slate-100 flex flex-col">
              <div className="mb-8">
                <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white mb-4 shadow-lg shadow-primary/20">
                  <CalendarIcon size={24} />
                </div>
                <h3 className="text-2xl font-black tracking-tight text-secondary">New Appointment</h3>
                <p className="text-slate-400 font-medium text-sm mt-1">MedCita Quick Scheduler</p>
              </div>

              {formData.patientName && (
                <div className="mb-6 animate-in fade-in slide-in-from-left-2">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Patient</p>
                  <p className="text-secondary font-bold flex items-center gap-2">
                    <User size={14} className="text-primary" /> {formData.patientName}
                  </p>
                </div>
              )}

              {formData.date && modalStep > 1 && (
                <div className="mb-6 animate-in fade-in slide-in-from-left-2">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Date & Time</p>
                  <p className="text-secondary font-bold flex items-center gap-2">
                    <Clock size={14} className="text-primary" /> {formData.date} {formData.time && `@ ${formData.time}`}
                  </p>
                </div>
              )}

              <div className="mt-auto pt-8">
                <div className="flex gap-1.5">
                  {[1, 2, 3].map(s => (
                    <div key={s} className={`h-1.5 rounded-full flex-1 transition-all ${modalStep >= s ? 'bg-primary' : 'bg-slate-200'}`} />
                  ))}
                </div>
                <p className="text-[10px] font-black text-slate-400 uppercase mt-3 tracking-widest text-center">Step {modalStep} of 3</p>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col relative">
              <button
                onClick={() => setShowModal(false)}
                aria-label="Close"
                className="absolute right-5 top-5 sm:right-8 sm:top-8 p-2 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-secondary transition-colors z-10"
              >
                <X size={20} />
              </button>

              <div className="p-6 sm:p-10 flex-1 overflow-y-auto">
                
                {/* Step 1: Select Doctor & Patient */}
                {modalStep === 1 && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <h4 className="text-xl font-black text-secondary mb-6 tracking-tight">Who are we seeing?</h4>
                    
                    {isSpecialRole && (
                      <div className="mb-6 animate-in slide-in-from-top-2">
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1 tracking-widest">Select Doctor</label>
                        <select 
                          className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-secondary outline-none focus:ring-4 focus:ring-primary/10"
                          value={formData.doctorId}
                          onChange={(e) => setFormData({...formData, doctorId: e.target.value})}
                        >
                          {doctors.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="relative mb-6">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                      <input 
                        type="text"
                        placeholder="Search existing patient..."
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-primary/10 transition-all font-bold"
                        onChange={(e) => debouncedSearch(e.target.value)}
                      />
                    </div>

                    <div className="space-y-3 max-h-60 overflow-y-auto mb-6 pr-2 custom-scrollbar">
                      {patients.map(p => (
                        <button 
                          key={p.id}
                          onClick={() => selectPatient(p)}
                          className="w-full text-left p-4 rounded-2xl border border-slate-50 hover:border-primary/30 hover:bg-primary/5 flex items-center justify-between group transition-all"
                        >
                          <div>
                            <p className="font-bold text-secondary">{p.name}</p>
                            <p className="text-xs text-slate-400">{p.phone}</p>
                          </div>
                          <ChevronRight size={18} className="text-slate-200 group-hover:text-primary transition-colors" />
                        </button>
                      ))}
                    </div>

                    <div className="pt-6 border-t border-slate-50">
                      <p className="text-sm text-slate-400 font-medium mb-4 text-center">Not on the list?</p>
                      <button 
                        onClick={skipPatientStep}
                        className="w-full py-4 bg-white border-2 border-primary text-primary font-black rounded-2xl hover:bg-primary hover:text-white transition-all transform active:scale-[0.98]"
                      >
                        Create New Patient
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2: Date & Time */}
                {modalStep === 2 && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col h-full">
                    <h4 className="text-xl font-black text-secondary mb-6">When?</h4>
                    
                    <div className="mb-6">
                      <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1 tracking-widest">Select Date</label>
                      <input 
                        type="date"
                        className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-secondary outline-none focus:ring-4 focus:ring-primary/10"
                        value={formData.date}
                        min={format(new Date(), 'yyyy-MM-dd')}
                        onChange={(e) => setFormData({...formData, date: e.target.value})}
                      />
                    </div>

                    <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1 tracking-widest">Available Slots</label>
                    {loadingSlots ? (
                      <div className="grid grid-cols-3 gap-3 animate-pulse">
                        {[1,2,3,4,5,6].map(i => <div key={i} className="h-12 bg-slate-50 rounded-xl" />)}
                      </div>
                    ) : availableSlots.length > 0 ? (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 overflow-y-auto max-h-64 pr-2 custom-scrollbar">
                        {availableSlots.map(slot => (
                          <button 
                            key={slot.time}
                            disabled={slot.status === 'booked'}
                            onClick={() => {
                              setFormData({...formData, time: slot.time});
                              setModalStep(3);
                            }}
                            className={`p-2 rounded-xl border-2 font-black transition-all text-xs flex flex-col items-center justify-center gap-0.5 ${
                              slot.status === 'booked'
                              ? 'bg-orange-50 border-orange-100 text-orange-400 cursor-not-allowed opacity-70'
                              : formData.time === slot.time 
                                ? 'bg-[#10b981] border-[#10b981] text-white scale-105 shadow-lg shadow-[#10b981]/20' 
                                : 'bg-green-50/30 border-green-100 text-[#10b981] hover:border-[#10b981] hover:bg-green-50'
                            }`}
                          >
                            <span>{slot.time}</span>
                            <span className="text-[8px] uppercase tracking-tighter opacity-70">
                              {slot.status === 'booked' ? 'Ocupado' : 'Libre'}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center bg-red-50 rounded-2xl border border-red-100">
                        <AlertCircle className="mx-auto text-red-400 mb-2" />
                        <p className="text-sm font-bold text-red-500">No availability for this date</p>
                      </div>
                    )}

                    <button 
                      onClick={() => setModalStep(1)}
                      className="mt-auto pt-6 text-slate-400 font-bold text-sm hover:text-primary transition-colors text-center"
                    >
                      &larr; Back to Patient
                    </button>
                  </div>
                )}

                {/* Step 3: Final Confirm */}
                {modalStep === 3 && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <h4 className="text-xl font-black text-secondary mb-6">Last details</h4>
                    
                    <form onSubmit={handleSubmit} className="space-y-4">
                      {!formData.patientId && (
                        <div className="space-y-4 animate-in fade-in duration-500">
                          <div>
                            <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1 tracking-widest">Full Name</label>
                            <input 
                              required
                              placeholder="e.g. John Doe"
                              className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-base focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                              value={formData.patientName}
                              onChange={(e) => setFormData({...formData, patientName: e.target.value})}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1 tracking-widest">WhatsApp Number</label>
                            <input 
                              required
                              placeholder="+593..."
                              className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-base focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                              value={formData.patientPhone}
                              onChange={(e) => setFormData({...formData, patientPhone: e.target.value})}
                            />
                          </div>
                        </div>
                      )}

                      <div className="space-y-4">
                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1 tracking-widest">Identification (Cédula)</label>
                          <input 
                            className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-base focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                            placeholder="Optional ID Number"
                            value={formData.patientCedula}
                            onChange={(e) => setFormData({...formData, patientCedula: e.target.value})}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1 tracking-widest">Email Address</label>
                          <input 
                            type="email"
                            className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-base focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                            placeholder="Optional Email for Notifications"
                            value={formData.patientEmail}
                            onChange={(e) => setFormData({...formData, patientEmail: e.target.value})}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1 tracking-widest">Notes / Observations</label>
                        <textarea 
                          className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-base focus:ring-4 focus:ring-primary/10 outline-none transition-all resize-none"
                          rows="3"
                          placeholder="Symptoms, previous treatments..."
                          value={formData.notes}
                          onChange={(e) => setFormData({...formData, notes: e.target.value})}
                        />
                      </div>

                      <div className="pt-6 flex gap-4">
                        <button 
                          type="button"
                          onClick={() => setModalStep(2)}
                          className="flex-1 py-4 text-slate-400 font-bold uppercase tracking-widest text-[10px] hover:bg-slate-50 rounded-2xl transition-all"
                        >
                          Change Date
                        </button>
                        <button 
                          type="submit"
                          className="flex-[2] py-4 bg-primary text-white font-black rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all text-sm uppercase tracking-widest"
                        >
                          Confirm Appointment
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Edit/Manage Appointment Modal */}
      {showEditModal && selectedEvent && (
        <div className="fixed inset-0 z-[150] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-8">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md transition-opacity" onClick={() => setShowEditModal(false)}></div>
            
            <div className="modal-panel relative rounded-[3rem] max-w-2xl animate-in zoom-in-95 duration-300">
              <div className="flex flex-col md:flex-row">
                {/* Status Sidebar */}
                <div className={`w-full md:w-1/3 p-6 sm:p-8 flex flex-row md:flex-col items-center gap-4 md:gap-0 justify-center text-white text-center
                  ${selectedEvent.status === 'confirmed' ? 'bg-[#10b981]' :
                    selectedEvent.status === 'pending_approval' ? 'bg-[#f59e0b]' : 'bg-[#0ea5e9]'}
                `}>
                  <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center md:mb-4 backdrop-blur-md shrink-0">
                    <User size={32} />
                  </div>
                  <div className="text-left md:text-center">
                    <h3 className="text-sm font-black uppercase tracking-widest opacity-80 mb-1">Appointment</h3>
                    <p className="text-2xl font-black leading-tight">{selectedEvent.status === 'confirmed' ? 'Confirmed' : 'Pending'}</p>
                  </div>
                </div>

                {/* Details Area */}
                <div className="flex-1 p-6 sm:p-10">
                  <div className="flex justify-between items-start mb-8">
                    <div>
                      <h4 className="text-2xl font-black text-secondary">{selectedEvent.Patient?.name}</h4>
                      <div className="flex items-center gap-2 text-slate-400 font-bold text-xs mt-1">
                        <CalendarIcon size={14} />
                        <span>{selectedEvent.date}</span>
                        <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                        <Clock size={14} />
                        <span>{selectedEvent.time}</span>
                      </div>
                    </div>
                    <button onClick={() => setShowEditModal(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                      <X size={20} className="text-slate-400" />
                    </button>
                  </div>

                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100/50">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">WhatsApp</p>
                        <p className="text-secondary font-bold text-sm">{selectedEvent.Patient?.phone}</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100/50">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Cédula</p>
                        <p className="text-secondary font-bold text-sm">{selectedEvent.Patient?.cedula || '---'}</p>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100/50">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Patient Email</p>
                      <p className="text-secondary font-bold text-sm">{selectedEvent.Patient?.email || 'No email provided'}</p>
                    </div>

                    {selectedEvent.notes && (
                      <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100/30">
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Internal Notes</p>
                        <p className="text-secondary/70 font-medium text-sm italic italic">"{selectedEvent.notes}"</p>
                      </div>
                    )}

                    <div className="pt-6 flex gap-4">
                      {selectedEvent.status !== 'confirmed' && (
                        <button 
                          onClick={() => handleUpdateStatus(selectedEvent.id, 'confirmed')}
                          className="flex-[2] py-4 bg-[#10b981] text-white font-black rounded-2xl shadow-xl shadow-[#10b981]/20 hover:scale-[1.02] active:scale-95 transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                          <CheckCircle2 size={18} /> Confirm Appointment
                        </button>
                      )}
                      <button 
                         onClick={() => handleDeleteAppointment(selectedEvent.id)}
                         className="flex-1 py-4 border-2 border-red-100 text-red-400 font-black rounded-2xl hover:bg-red-50 transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-2"
                      >
                        <AlertCircle size={18} /> Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Dashboard;
