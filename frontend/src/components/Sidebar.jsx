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
  BarChart2,
  X
} from 'lucide-react';

const Sidebar = ({ isOpen = false, onClose = () => {} }) => {
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
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-30 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          w-64 bg-secondary h-screen flex flex-col text-white shadow-2xl z-40
          fixed top-0 left-0 md:sticky transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        `}
      >
        <div className="p-8 flex items-center gap-3 border-b border-white/5">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg">
            <Stethoscope className="text-white w-6 h-6" />
          </div>
          <span className="text-2xl font-black tracking-tighter">MedCita</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto p-1.5 hover:bg-white/10 rounded-lg transition-colors md:hidden"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-4 py-8 space-y-2 overflow-y-auto">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
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
    </>
  );
};

export default Sidebar;
