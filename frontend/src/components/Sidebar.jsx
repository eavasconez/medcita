import React, { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import { AuthContext } from '../App';
import { 
  Calendar, 
  Users, 
  Clock, 
  Settings, 
  LogOut, 
  Stethoscope,
  Shield,
  BarChart2
} from 'lucide-react';

const Sidebar = () => {
  const { user, logout } = useContext(AuthContext);

  let menuItems = [];

  if (user?.role === 'admin') {
    menuItems = [
      { icon: <BarChart2 size={20} />, label: 'Analytics', path: '/reports' },
      { icon: <Shield size={20} />, label: 'Manage Doctors', path: '/admin' },
      { icon: <Users size={20} />, label: 'Patients', path: '/patients' },
      { icon: <Clock size={20} />, label: 'Availability', path: '/availability' },
      { icon: <Settings size={20} />, label: 'Settings', path: '/settings' },
      { icon: <Calendar size={20} />, label: 'My Schedule', path: '/dashboard' },
    ];
  } else {
    menuItems = [
      { icon: <Calendar size={20} />, label: 'My Schedule', path: '/dashboard' },
      { icon: <Users size={20} />, label: 'Patients', path: '/patients' },
      { icon: <Clock size={20} />, label: 'Availability', path: '/availability' },
      { icon: <Settings size={20} />, label: 'Settings', path: '/settings' },
    ];
  }

  return (
    <aside className="w-64 bg-secondary h-screen sticky top-0 flex flex-col text-white shadow-2xl z-20">
      <div className="p-8 flex items-center gap-3 border-b border-white/5">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg">
          <Stethoscope className="text-white w-6 h-6" />
        </div>
        <span className="text-2xl font-black tracking-tighter">MedCita</span>
      </div>

      <nav className="flex-1 px-4 py-8 space-y-2">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `
              flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 group
              ${isActive 
                ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-[1.02]' 
                : 'text-slate-400 hover:bg-white/5 hover:text-white'}
            `}
          >
            {item.icon}
            <span className="font-semibold text-sm">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-6 border-t border-white/5">
        <div className="bg-white/5 rounded-2xl p-4 mb-4">
          <p className="text-xs text-slate-400 mb-1">Active User</p>
          <p className="text-sm font-bold truncate">{user?.name}</p>
          <p className="text-[10px] text-primary font-bold uppercase tracking-widest">{user?.role}</p>
        </div>
        
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-400/10 rounded-xl transition-all text-sm font-bold"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
