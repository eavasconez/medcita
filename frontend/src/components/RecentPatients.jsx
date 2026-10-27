import React from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';

// The patients opened lately, one click away (what the browser remembers: only id and name)
const RecentPatients = ({ patients }) => {
  if (patients.length === 0) return null;
  return (
    <section aria-label="Recent patients" className="mb-6">
      <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400"><History size={13} /> Recent</p>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {patients.map((p) => (
          <li key={p.id} className="shrink-0">
            <Link to={`/patients/${p.id}`} className="flex max-w-[14rem] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-secondary transition-colors hover:border-primary hover:text-primary">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-black text-primary">{p.name.charAt(0).toUpperCase()}</span>
              <span className="truncate">{p.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default RecentPatients;
