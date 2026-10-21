import React from 'react';
import { IS_STAGING } from '../config/environment';

// A tab hanging from the top edge of every screen of the staging site, so test data and
// real data are never confused. It floats over the page (it takes no room, so no layout
// shifts) and lets clicks through. Renders nothing in production.
const EnvironmentBanner = () => {
  if (!IS_STAGING) return null;
  return (
    <div role="status" className="fixed top-0 left-1/2 -translate-x-1/2 z-[300] pointer-events-none bg-amber-400 text-amber-950 text-[11px] font-black uppercase tracking-widest py-1 px-4 rounded-b-xl shadow-md whitespace-nowrap">
      Staging · test data
    </div>
  );
};

export default EnvironmentBanner;
