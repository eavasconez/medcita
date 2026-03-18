import React, { useContext } from 'react';
import Layout from '../components/Layout';
import { AuthContext } from '../App';
import { 
  User, 
  Mail, 
  Shield, 
  Calendar, 
  Hospital, 
  Bell, 
  Lock,
  Camera
} from 'lucide-react';

const Settings = () => {
  const { user } = useContext(AuthContext);

  const stats = [
    { label: 'Role', value: user?.role, icon: <Shield size={18} />, color: 'text-primary bg-primary/10' },
    { label: 'Account Created', value: new Date(user?.createdAt).toLocaleDateString(), icon: <Calendar size={18} />, color: 'text-green-500 bg-green-50' },
    { label: 'Status', value: 'Active', icon: <Bell size={18} />, color: 'text-orange-500 bg-orange-50' },
  ];

  return (
    <Layout>
      <div className="p-8 max-w-5xl mx-auto">
        <header className="mb-12">
          <h1 className="text-4xl font-black text-secondary tracking-tight">Account Settings</h1>
          <p className="text-slate-400 font-medium mt-2">Manage your profile and clinical preferences</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Profile Card */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-50 p-8 overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-r from-primary to-blue-400 opacity-10"></div>
              
              <div className="relative flex flex-col items-center">
                <div className="relative group mb-6">
                  <div className="w-32 h-32 bg-slate-100 rounded-[2rem] flex items-center justify-center border-4 border-white shadow-xl overflow-hidden">
                    <User size={64} className="text-slate-300" />
                  </div>
                  <button className="absolute bottom-0 right-0 bg-primary text-white p-2.5 rounded-xl shadow-lg hover:scale-110 active:scale-95 transition-all">
                    <Camera size={18} />
                  </button>
                </div>

                <h2 className="text-2xl font-black text-secondary text-center">{user?.name}</h2>
                <p className="text-primary font-bold text-sm uppercase tracking-widest mt-1">{user?.role}</p>

                <div className="w-full mt-8 space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100/50">
                    <div className="p-2.5 bg-white rounded-xl shadow-sm">
                      <Mail size={18} className="text-slate-400" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email Address</p>
                      <p className="text-secondary font-bold text-sm truncate">{user?.email}</p>
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
            <div className="bg-white rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-50 p-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
                  <User size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-secondary uppercase tracking-tight">Personal Information</h3>
                  <p className="text-slate-400 font-medium text-sm">Update your public profile and identity</p>
                </div>
              </div>

              <form className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                    <input 
                      type="text" 
                      defaultValue={user?.name}
                      className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-secondary outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Specialty</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Cardiology"
                      className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-secondary outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Professional Bio</label>
                  <textarea 
                    rows="4"
                    placeholder="Brief description for patients..."
                    className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-secondary outline-none focus:ring-4 focus:ring-primary/10 transition-all resize-none"
                  ></textarea>
                </div>

                <div className="pt-4">
                  <button className="bg-primary text-white px-10 py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all">
                    Save Changes
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-white rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-50 p-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 shadow-sm border border-slate-100">
                  <Lock size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-secondary uppercase tracking-tight text-slate-400">Security & Privacy</h3>
                  <p className="text-slate-400 font-medium text-sm">Manage your password and session security</p>
                </div>
              </div>
              
              <div className="p-8 border-2 border-dashed border-slate-100 rounded-[2rem] flex flex-col items-center justify-center text-center">
                <Lock size={32} className="text-slate-200 mb-4" />
                <p className="text-slate-400 font-bold max-w-xs">Security settings are temporarily locked for demo accounts.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Settings;
