import React from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope } from 'lucide-react';
import { EMPRESA } from '../utils/legalText';
import { PUBLIC_LINKS } from '../utils/publicLinks';

// Shared frame of the public pages (home, privacy, terms, data deletion, contact): the
// pages anyone can open without signing in, and the ones Meta and Google read. They are in
// Spanish because they are written for the public in Ecuador (docs/TECHNICAL.md, section 8).
const PublicLayout = ({ children }) => (
  <div className="min-h-screen bg-slate-50 flex flex-col">
    <header className="bg-secondary text-white">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-center gap-3">
        <Link to="/" className="flex items-center gap-3">
          <Stethoscope size={22} className="text-primary" />
          <span className="text-lg font-black tracking-tighter">MedCita</span>
        </Link>
        <Link to="/login" className="ml-auto text-sm font-bold text-slate-300 hover:text-white">
          Iniciar sesión
        </Link>
      </div>
    </header>

    <main className="flex-1">{children}</main>

    <footer className="bg-white border-t border-slate-100">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-4">
        <nav aria-label="Información legal" className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-bold text-primary">
          {PUBLIC_LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="hover:underline underline-offset-4">{link.label}</Link>
          ))}
        </nav>
        <p className="text-xs text-slate-400 font-medium">
          MedCita es operada por {EMPRESA.razon_social} · RUC {EMPRESA.ruc} · {EMPRESA.domicilio} ·{' '}
          <a href={`mailto:${EMPRESA.correo_privacidad}`} className="hover:underline">{EMPRESA.correo_privacidad}</a>
        </p>
      </div>
    </footer>
  </div>
);

export default PublicLayout;
