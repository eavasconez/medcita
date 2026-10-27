import React, { useState, useEffect, useContext } from 'react';
import Sidebar from './Sidebar';
import { AuthContext } from '../AuthContext';
import { Menu, Stethoscope } from 'lucide-react';

// `fullHeight` (from `md` up) makes the screen exactly as tall as the window and lets the page
// decide which of its parts scrolls (the record keeps its header in place and scrolls only the
// content); on a phone the page scrolls as usual.
const Layout = ({ children, fullHeight = false }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { user } = useContext(AuthContext);

  // The drawer is only meaningful below md; force it closed if the
  // viewport grows past that so it can't get stuck open (and trapping
  // focus) once the sidebar becomes permanently visible.
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setIsSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={`flex bg-slate-50 min-h-screen ${fullHeight ? 'md:h-screen md:overflow-hidden' : ''}`}>
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className={`flex-1 flex flex-col min-w-0 ${fullHeight ? 'md:min-h-0' : ''}`}>
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-3 bg-secondary text-white px-4 py-4 shadow-lg">
          <button
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open menu"
            className="p-2 -ml-2 hover:bg-white/10 rounded-xl transition-colors"
          >
            <Menu size={24} />
          </button>
          <Stethoscope size={20} className="text-primary" />
          <span className="text-lg font-black tracking-tighter">MedCita</span>
          {user?.clinic?.name && (
            <span className="ml-1 pl-3 border-l border-white/20 text-sm font-semibold text-slate-300 truncate" title={user.clinic.name}>
              {user.clinic.name}
            </span>
          )}
        </header>

        <main className={`flex-1 ${fullHeight ? 'overflow-x-clip md:min-h-0 md:overflow-hidden' : 'overflow-x-clip'}`}>
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
