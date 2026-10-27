import React from 'react';

// "There is nothing here": what it is and, if there is one, what to do about it. The dashed frame
// is what says it is a placeholder and not content. For a request that FAILED use LoadError.
const EmptyState = ({ icon: Icon, title, children, action, className = '' }) => (
  <div className={`py-16 px-6 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200 ${className}`}>
    {Icon && <Icon className="mx-auto text-slate-300 w-12 h-12 mb-3" />}
    {title && <p className="text-secondary font-black text-lg">{title}</p>}
    {children && <div className="text-slate-400 font-medium mt-1">{children}</div>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export default EmptyState;
