import React from 'react';
import { AlertTriangle } from 'lucide-react';
import PublicLayout from '../components/PublicLayout';
import SimpleMarkdown from '../components/SimpleMarkdown';
import { LEGAL_REVIEWED } from '../config/legal';
import { fillCompany } from '../utils/legalText';
import privacy from '../../../docs/legal/politica-de-privacidad.md?raw';
import terms from '../../../docs/legal/terminos-de-uso.md?raw';
import deletion from '../../../docs/legal/eliminacion-de-datos.md?raw';
import contact from '../../../docs/legal/contacto.md?raw';

const DOCUMENTS = { privacy, terms, deletion, contact };

// A public legal page (/privacy, /terms, /data-deletion, /contact): the text comes straight
// from docs/legal/, so what the lawyer reviews is what people read. The company's details
// come from docs/legal/empresa.json.
const LegalDocument = ({ document }) => (
  <PublicLayout>
    <div className="max-w-3xl mx-auto px-6 py-10">
      {!LEGAL_REVIEWED && (
        <div role="note" className="mb-8 p-5 bg-amber-50 border border-amber-100 rounded-3xl flex items-start gap-4">
          <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={22} />
          <p className="text-sm font-medium text-amber-700">
            <span className="font-black">Borrador pendiente de revisión legal.</span> Este texto aún no ha sido revisado por un abogado y las
            partes marcadas [PENDIENTE] están por completar. Puede cambiar antes de que MedCita se use con pacientes reales.
          </p>
        </div>
      )}
      <article className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 sm:p-12">
        <SimpleMarkdown source={fillCompany(DOCUMENTS[document])} />
      </article>
    </div>
  </PublicLayout>
);

export default LegalDocument;
