import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Download, FileDown, ClipboardList, Edit, Trash2 } from 'lucide-react';

const icon = 'text-primary transition-colors p-1.5 hover:bg-primary/5 rounded-lg';

// What can be done with one patient from the list, the same in the table and in the card: open the
// record, the health-data consent, edit and delete (blocked while the patient has appointments) and,
// for admins only, the exports of their data.
const PatientActions = ({ patient: p, isAdmin, onConsent, onExport, onEdit, onDelete }) => {
  const blocked = (p._count?.appointments || 0) > 0;
  return (
    <div className="flex items-center">
      <button onClick={(e) => { e.stopPropagation(); onConsent(p); }} aria-label={`Consent of ${p.name}`} title="Health data consent" className={icon}>
        <ShieldCheck size={17} />
      </button>
      {isAdmin && (
        <button onClick={(e) => { e.stopPropagation(); onExport(p); }} aria-label={`Export the data of ${p.name}`} title="Export this patient's data" className={icon}>
          <Download size={17} />
        </button>
      )}
      {isAdmin && (
        <button onClick={(e) => { e.stopPropagation(); onExport(p, 'pdf'); }} aria-label={`Export the record of ${p.name} as PDF`} title="Export this patient's record as PDF" className={icon}>
          <FileDown size={17} />
        </button>
      )}
      <Link to={`/patients/${p.id}`} onClick={(e) => e.stopPropagation()} aria-label={`Open the record of ${p.name}`} title="Open the record" className={icon}>
        <ClipboardList size={17} />
      </Link>
      <button onClick={(e) => { e.stopPropagation(); onEdit(p); }} aria-label={`Edit ${p.name}`} className={icon}>
        <Edit size={17} />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(p); }}
        disabled={blocked}
        title={blocked ? 'Patients with appointments cannot be deleted' : 'Delete patient'}
        aria-label={`Delete ${p.name}`}
        className="text-red-500 transition-colors p-1.5 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
      >
        <Trash2 size={17} />
      </button>
    </div>
  );
};

export default PatientActions;
