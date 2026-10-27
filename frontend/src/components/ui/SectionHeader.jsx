import React from 'react';

// The heading of a block of a page: title, an optional line under it, an optional icon and the
// actions of the block on the right (they wrap under the title on a narrow screen).
// `variant="label"` is the small uppercase heading used above lists and sub-blocks; the default
// is the larger title of a whole section.
const SectionHeader = ({ title, description, icon: Icon, actions, as: Tag = 'h2', variant = 'title', className = '' }) => {
  const label = variant === 'label';
  return (
    <div className={`flex flex-wrap justify-between gap-3 ${label ? 'items-center' : 'items-start'} ${className}`}>
      <div className={`flex gap-3 min-w-0 ${label ? 'items-center' : 'items-start'}`}>
        {Icon && <Icon size={label ? 16 : 22} className={`shrink-0 text-primary ${label ? '' : 'mt-0.5'}`} />}
        <div className="min-w-0">
          {React.createElement(Tag, { className: label ? 'text-sm font-black text-secondary uppercase tracking-widest' : 'section-title' }, title)}
          {description && <p className="text-sm font-medium text-slate-400 mt-0.5">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
};

export default SectionHeader;
