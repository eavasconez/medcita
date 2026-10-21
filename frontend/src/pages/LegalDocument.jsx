import React from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, ArrowLeft, AlertTriangle } from 'lucide-react';
import SimpleMarkdown from '../components/SimpleMarkdown';
import { LEGAL_REVIEWED } from '../config/legal';
import privacy from '../../../docs/legal/politica-de-privacidad.md?raw';
import terms from '../../../docs/legal/terminos-de-uso.md?raw';

const DOCUMENTS = { privacy, terms };

// The public privacy policy (/privacy) and terms of use (/terms): the text comes straight
// from docs/legal/, so what the lawyer reviews is what people read.
const LegalDocument = ({ document }) => (
  <div className="min-h-screen bg-slate-50">
    <header className="bg-secondary text-white">
      <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
        <Stethoscope size={22} className="text-primary" />
        <span className="text-lg font-black tracking-tighter">MedCita</span>
        <Link to="/login" className="ml-auto flex items-center gap-2 text-sm font-bold text-slate-300 hover:text-white">
          <ArrowLeft size={16} /> Back
        </Link>
      </div>
    </header>

    <main className="max-w-3xl mx-auto px-6 py-10">
      {!LEGAL_REVIEWED && (
        <div role="note" className="mb-8 p-5 bg-amber-50 border border-amber-100 rounded-3xl flex items-start gap-4">
          <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={22} />
          <p className="text-sm font-medium text-amber-700">
            <span className="font-black">Draft pending legal review.</span> This text has not been reviewed by a lawyer yet, and the parts marked
            [PENDIENTE] are still to be completed. It may change before MedCita is used with real patients.
          </p>
        </div>
      )}
      <article className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 sm:p-12">
        <SimpleMarkdown source={DOCUMENTS[document]} />
      </article>
      <nav className="mt-6 flex gap-6 text-sm font-bold text-primary">
        <Link to="/privacy">Privacy policy</Link>
        <Link to="/terms">Terms of use</Link>
      </nav>
    </main>
  </div>
);

export default LegalDocument;
