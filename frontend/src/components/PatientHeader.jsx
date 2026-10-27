import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import ConsentBadge from './ConsentBadge';
import ClinicalAlert from './ClinicalAlert';
import { MinorBadge, Skeleton } from './ui';
import { SEX_LABEL, formatAge } from '../utils/patientRecord';

const Crumbs = ({ patient, crumb }) => (
  <nav aria-label="Breadcrumb" className="mb-2 md:mb-1 md:col-span-2">
    <ol className="flex min-w-0 items-center gap-1 text-xs font-bold text-slate-400">
      <li className="shrink-0"><Link to="/patients" className="hover:text-primary">Patients</Link></li>
      {patient && (
        <>
          <ChevronRight size={12} aria-hidden="true" className="shrink-0" />
          <li className="min-w-0 truncate">
            {crumb ? <Link to={`/patients/${patient.id}`} className="hover:text-primary">{patient.name}</Link> : <span aria-current="page">{patient.name}</span>}
          </li>
        </>
      )}
      {patient && crumb && (
        <>
          <ChevronRight size={12} aria-hidden="true" className="shrink-0" />
          <li className="shrink-0 text-slate-500" aria-current="page">{crumb}</li>
        </>
      )}
    </ol>
  </nav>
);

// Who this screen is about: the same block on the record, the consultation note and the timeline.
// The name, age, ID, consent and minor badges stay pinned to the top while the page scrolls, with
// the clinical alert (allergies, regular medication) right under them. `actions` are the buttons of
// the screen; `summary` is the clinical summary and is only passed for the roles that may read it.
//
// Layout: from `md` the whole block is one sticky grid. Below `md` the wrapper is `display:
// contents`, so the identity and the alert become siblings that stick under the mobile top bar
// (the breadcrumb and the actions scroll away, not to take the phone's screen).
const PatientHeader = ({ patient, loading = false, summary = null, actions = null, crumb = null }) => {
  if (!patient && !loading) {
    return <div className="mb-6"><Crumbs patient={null} /></div>;
  }

  return (
    <div className="contents md:grid md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-6 md:sticky md:top-0 md:z-10 md:bg-slate-50 md:pt-3 md:pb-3 md:mb-6 md:border-b md:border-slate-200">
      <Crumbs patient={patient} crumb={crumb} />

      <div className="sticky top-[calc(3rem+24px)] z-10 mb-4 border-b border-slate-200 bg-slate-50 pb-3 pt-2 md:contents">
        {patient ? (
          <div className="min-w-0 md:col-start-1 md:row-start-2">
            <h2 className="truncate text-2xl font-black leading-8 tracking-tight text-secondary sm:text-3xl sm:leading-9" title={patient.name}>{patient.name}</h2>
            <div className="mt-1 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-sm font-medium text-slate-500">
                {[formatAge(patient.age), patient.sex && SEX_LABEL[patient.sex], patient.cedula].filter(Boolean).join(' · ') || 'Patient record'}
              </p>
              <ConsentBadge consent={patient.consent} />
              {patient.isMinor && <MinorBadge />}
            </div>
          </div>
        ) : (
          <div aria-busy="true" className="md:col-start-1 md:row-start-2">
            <span className="sr-only">Loading patient...</span>
            <Skeleton className="h-8 w-64 sm:h-9" />
            <div className="mt-1 flex min-h-7 items-center"><Skeleton className="h-5 w-56" /></div>
          </div>
        )}
        <div className="md:col-span-2 md:row-start-3">
          <ClinicalAlert summary={summary} banner />
        </div>
      </div>

      {actions && <div className="mb-6 flex flex-wrap gap-2 md:col-start-2 md:row-start-2 md:mb-0 md:items-start">{actions}</div>}
    </div>
  );
};

export default PatientHeader;
