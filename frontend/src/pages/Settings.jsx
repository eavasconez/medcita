import React, { useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import Layout from '../components/Layout';
import { AuthContext } from '../AuthContext';
import {
  User,
  Mail,
  Shield,
  Calendar,
  CalendarCheck,
  Lock,
  Building2,
  Save,
  CheckCircle2,
  AlertCircle,
  X
} from 'lucide-react';

const MIN_PASSWORD_LENGTH = 6;
const DEFAULT_TIMEZONE = 'America/Guayaquil';

// "America/Guayaquil (GMT-5)": the zone name plus how far it is from UTC right now
const timezoneLabel = (zone) => {
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    return offset ? `${zone} (${offset})` : zone;
  } catch {
    return zone;
  }
};

const allTimezones = () => [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC'])];

const Settings = () => {
  const { user, token, updateUser, updateToken } = useContext(AuthContext);

  const [profile, setProfile] = useState(null);
  const [formData, setFormData] = useState({ name: '', specialty: '', bio: '', address: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changingPassword, setChangingPassword] = useState(false);
  const [clinicName, setClinicName] = useState('');
  const [clinicTimezone, setClinicTimezone] = useState(DEFAULT_TIMEZONE);
  const [savingClinic, setSavingClinic] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`${API_BASE_URL}/api/auth/profile`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setProfile(res.data);
        setClinicName(res.data.clinic?.name || '');
        setClinicTimezone(res.data.clinic?.timezone || DEFAULT_TIMEZONE);
        setFormData({
          name: res.data.name || '',
          specialty: res.data.specialty || '',
          bio: res.data.bio || '',
          address: res.data.address || ''
        });
      } catch (err) {
        console.error(err);
        showToast('Could not load your profile', 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await axios.put(`${API_BASE_URL}/api/auth/profile`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProfile(res.data);
      // Keep the cached user (sidebar, greetings) in sync with the new name
      updateUser({ name: res.data.name });
      showToast('Profile updated successfully');
    } catch (err) {
      showToast(err.response?.data?.error || 'Error updating profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClinic = async (e) => {
    e.preventDefault();
    setSavingClinic(true);
    try {
      const res = await axios.put(`${API_BASE_URL}/api/admin/clinic`, { name: clinicName, timezone: clinicTimezone }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClinicName(res.data.name);
      setClinicTimezone(res.data.timezone);
      setProfile((prev) => ({ ...prev, clinic: res.data }));
      // The sidebar and the tab title read the clinic from the cached user
      updateUser({ clinic: res.data });
      showToast('Clinic updated');
    } catch (err) {
      showToast(err.response?.data?.error || 'Error updating the clinic', 'error');
    } finally {
      setSavingClinic(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    const { currentPassword, newPassword, confirmPassword } = passwordForm;

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      showToast(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('The new passwords do not match', 'error');
      return;
    }
    if (newPassword === currentPassword) {
      showToast('The new password must be different from the current one', 'error');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/auth/change-password`,
        { currentPassword, newPassword },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      // Every other session was signed out; this one continues with the new token.
      updateToken(res.data.token);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showToast('Password updated. Other devices have been signed out.');
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not update the password', 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  // Derive display data from the fetched profile, falling back to the cached
  // user only while the initial request is still in flight.
  const displayName = profile?.name || user?.name;
  const displayRole = profile?.role || user?.role;
  const displayEmail = profile?.email || user?.email;
  const createdAt = profile?.createdAt || user?.createdAt;

  const stats = [
    { label: 'Role', value: displayRole, icon: <Shield size={18} />, color: 'text-primary bg-primary/10' },
    { label: 'Account Created', value: createdAt ? new Date(createdAt).toLocaleDateString() : '—', icon: <Calendar size={18} />, color: 'text-green-500 bg-green-50' },
    { label: 'Total Appointments', value: profile?._count?.appointments ?? 0, icon: <CalendarCheck size={18} />, color: 'text-orange-500 bg-orange-50' },
  ];

  return (
    <Layout>
      {/* Toast Notification */}
      {toast && (
        <div className={`toast animate-in slide-in-from-bottom-5 fade-in duration-300
          ${toast.type === 'success' ? 'bg-[#10b981] shadow-[#10b981]/30' : 'bg-red-500 shadow-red-500/30'}
        `}>
          {toast.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          <span className="text-sm shadow-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss notification" className="ml-auto hover:opacity-75 transition-opacity">
            <X size={18} />
          </button>
        </div>
      )}

      <div className="page-shell max-w-5xl">
        <header className="mb-12">
          <h1 className="text-3xl sm:text-4xl font-black text-secondary tracking-tight">Account Settings</h1>
          <p className="text-slate-400 font-medium mt-2">Manage your profile and clinical preferences</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Profile Card */}
          <div className="lg:col-span-1">
            <div className="card overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-r from-primary to-blue-400 opacity-10"></div>

              <div className="relative flex flex-col items-center">
                <div className="relative group mb-6">
                  <div className="w-32 h-32 bg-slate-100 rounded-[2rem] flex items-center justify-center border-4 border-white shadow-xl overflow-hidden">
                    <User size={64} className="text-slate-300" />
                  </div>
                </div>

                <h2 className="text-2xl font-black text-secondary text-center">{displayName}</h2>
                <p className="text-primary font-bold text-sm uppercase tracking-widest mt-1">{displayRole}</p>
                {profile?.specialty && (
                  <p className="text-slate-400 font-medium text-sm mt-1">{profile.specialty}</p>
                )}

                <div className="w-full mt-8 space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100/50">
                    <div className="p-2.5 bg-white rounded-xl shadow-sm">
                      <Mail size={18} className="text-slate-400" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email Address</p>
                      <p className="text-secondary font-bold text-sm truncate">{displayEmail}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Sidebar */}
            <div className="mt-8 space-y-4">
              {stats.map((stat, i) => (
                <div key={i} className="bg-white p-5 rounded-2xl border border-slate-50 flex items-center gap-4 shadow-sm">
                  <div className={`p-3 rounded-xl ${stat.color}`}>
                    {stat.icon}
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
                    <p className="text-secondary font-bold">{stat.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Settings Tabs/Forms */}
          <div className="lg:col-span-2 space-y-8">
            <div className="card sm:p-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-secondary rounded-2xl flex items-center justify-center text-white shadow-lg">
                  <Building2 size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-secondary uppercase tracking-tight">Clinic</h3>
                  <p className="text-slate-400 font-medium text-sm">The clinic you work at: patients, appointments and users belong to it</p>
                </div>
              </div>

              {displayRole === 'admin' ? (
                <form className="space-y-4" onSubmit={handleSaveClinic}>
                  <div className="space-y-2">
                    <label htmlFor="clinic-name" className="form-label">Clinic name</label>
                    <input
                      id="clinic-name"
                      type="text"
                      required
                      minLength={2}
                      maxLength={80}
                      disabled={loading}
                      value={clinicName}
                      onChange={(e) => setClinicName(e.target.value)}
                      className="form-input disabled:opacity-60"
                    />
                    <p className="text-slate-400 text-xs font-medium">Shown in the sidebar and in the invitations you send</p>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="clinic-timezone" className="form-label">Timezone</label>
                    <select
                      id="clinic-timezone"
                      disabled={loading}
                      value={clinicTimezone}
                      onChange={(e) => setClinicTimezone(e.target.value)}
                      className="form-input disabled:opacity-60"
                    >
                      {allTimezones().map((zone) => (
                        <option key={zone} value={zone}>{timezoneLabel(zone)}</option>
                      ))}
                    </select>
                    <p className="text-slate-400 text-xs font-medium">Appointment times, free slots and reminders are read in this zone. Changing it does not move the appointments already booked: they keep their local time.</p>
                  </div>
                  <button
                    type="submit"
                    disabled={savingClinic || loading || (clinicName.trim() === (profile?.clinic?.name || '') && clinicTimezone === (profile?.clinic?.timezone || DEFAULT_TIMEZONE))}
                    className="btn-primary px-8 py-3 rounded-xl flex items-center gap-2 disabled:opacity-50"
                  >
                    <Save size={18} /> {savingClinic ? 'Saving...' : 'Save clinic'}
                  </button>
                </form>
              ) : (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clinic name</p>
                  <p className="text-2xl font-black text-secondary mt-1 break-words">{profile?.clinic?.name || user?.clinic?.name || '—'}</p>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-4">Timezone</p>
                  <p className="text-lg font-black text-secondary mt-1 break-words">{timezoneLabel(profile?.clinic?.timezone || user?.clinic?.timezone || DEFAULT_TIMEZONE)}</p>
                  <p className="text-slate-400 text-xs font-medium mt-2">Only a clinic administrator can change them</p>
                </div>
              )}
            </div>

            <div className="card sm:p-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
                  <User size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-secondary uppercase tracking-tight">Personal Information</h3>
                  <p className="text-slate-400 font-medium text-sm">Update your public profile and identity</p>
                </div>
              </div>

              <form className="space-y-6" onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="form-label">Full Name</label>
                    <input
                      type="text"
                      required
                      disabled={loading}
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="form-input disabled:opacity-60"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="form-label">Specialty</label>
                    <input
                      type="text"
                      disabled={loading}
                      placeholder="e.g. Cardiology"
                      value={formData.specialty}
                      onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
                      className="form-input disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="form-label">Professional Bio</label>
                  <textarea
                    rows="4"
                    disabled={loading}
                    placeholder="Brief description for patients..."
                    value={formData.bio}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                    className="form-input resize-none disabled:opacity-60"
                  ></textarea>
                </div>

                <div className="space-y-2">
                  <label htmlFor="office-address" className="form-label">Office Address</label>
                  <input
                    id="office-address"
                    type="text"
                    disabled={loading}
                    placeholder="e.g. Av. Amazonas N34-12, Quito"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="form-input disabled:opacity-60"
                  />
                  <p className="text-slate-400 text-xs font-medium">Included in appointment confirmation emails sent to patients</p>
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={loading || saving}
                    className="btn-primary px-10 py-4 uppercase tracking-widest text-xs w-full sm:w-auto flex items-center justify-center gap-2 disabled:opacity-60 disabled:hover:scale-100"
                  >
                    <Save size={16} />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>

            <div className="card sm:p-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
                  <Lock size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-secondary uppercase tracking-tight">Security & Privacy</h3>
                  <p className="text-slate-400 font-medium text-sm">Manage your password and session security</p>
                </div>
              </div>

              <form className="space-y-6" onSubmit={handleChangePassword}>
                <div className="space-y-2">
                  <label htmlFor="current-password" className="form-label">Current Password</label>
                  <input
                    id="current-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                    className="form-input"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label htmlFor="new-password" className="form-label">New Password</label>
                    <input
                      id="new-password"
                      type="password"
                      required
                      autoComplete="new-password"
                      minLength={MIN_PASSWORD_LENGTH}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                      className="form-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="confirm-password" className="form-label">Confirm New Password</label>
                    <input
                      id="confirm-password"
                      type="password"
                      required
                      autoComplete="new-password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      className="form-input"
                    />
                  </div>
                </div>
                <p className="text-slate-400 text-xs font-medium">
                  At least {MIN_PASSWORD_LENGTH} characters. Changing it signs you out of every other device.
                </p>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={changingPassword}
                    className="btn-primary px-10 py-4 uppercase tracking-widest text-xs w-full sm:w-auto flex items-center justify-center gap-2 disabled:opacity-60 disabled:hover:scale-100"
                  >
                    <Lock size={16} />
                    {changingPassword ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Settings;
