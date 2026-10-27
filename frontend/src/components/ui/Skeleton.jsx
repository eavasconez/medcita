import React from 'react';

// A grey placeholder where something is loading: give it the size of what will arrive
// (`h-4 w-40`, `h-64 w-full`) so the page does not jump when it does.
const Skeleton = ({ className = '' }) => <div aria-hidden="true" className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />;

export default Skeleton;
