import React from 'react';

const TONES = {
  neutral: 'bg-neutral-soft text-neutral-ink',
  primary: 'bg-primary/10 text-primary-ink',
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-soft text-info-ink'
};

const SIZES = {
  sm: 'px-2 py-0.5 text-[9px]',
  md: 'px-2.5 py-1 text-[10px]',
  lg: 'px-3 py-1.5 text-[10px]'
};

// The small pill that says what state something is in. `tone` picks a soft color; `color` (a CSS
// color) paints it solid with white text, for the colors the calendar already gives each status.
const Badge = ({ tone = 'neutral', color, size = 'md', className = '', children }) => (
  <span
    className={`inline-block rounded-full font-black uppercase tracking-widest ${SIZES[size] || SIZES.md} ${color ? 'text-white' : TONES[tone] || TONES.neutral} ${className}`}
    style={color ? { background: color } : undefined}
  >
    {children}
  </span>
);

export default Badge;
