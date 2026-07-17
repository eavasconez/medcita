import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import { Menu, Stethoscope } from 'lucide-react';

const Layout = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
    <div className="flex bg-slate-50 min-h-screen">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
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
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
