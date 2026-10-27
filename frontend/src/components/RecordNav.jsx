import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';

const itemClass = (current, pills) => {
  const base = 'flex items-center gap-2 font-bold transition-colors whitespace-nowrap';
  if (pills) return `${base} px-3.5 py-2 rounded-xl text-[11px] uppercase tracking-widest ${current ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`;
  return `${base} w-full px-4 py-2.5 rounded-xl text-sm ${current ? 'bg-primary/10 text-primary-ink' : 'text-slate-500 hover:bg-white hover:text-secondary'}`;
};

// The sections of the record. A side list from `md` up, a row of pills over the content on a phone
// (`pills`). Each entry is a real link to `#section`, so it works with the keyboard and can be
// copied; the one being read carries aria-current. The timeline is another screen, not a section.
const RecordNav = ({ items, active, onSelect, timelineTo, pills = false, navRef }) => {
  const listRef = useRef(null);

  // On a phone the row scrolls sideways: keep the current pill in view
  useEffect(() => {
    if (!pills || !listRef.current) return;
    const current = listRef.current.querySelector('[aria-current="true"]');
    if (current) listRef.current.scrollTo({ left: current.offsetLeft - listRef.current.clientWidth / 2 + current.clientWidth / 2, behavior: 'smooth' });
  }, [active, pills]);

  return (
    <nav
      ref={navRef}
      aria-label="Record sections"
      className={pills ? 'md:hidden -mx-4 px-4 sm:-mx-6 sm:px-6 mt-3 pb-1' : 'hidden md:block'}
    >
      <ul ref={listRef} className={pills ? 'flex gap-2 overflow-x-auto pb-2' : 'space-y-1'}>
        {items.map(({ id, label, icon: Icon }) => (
          <li key={id} className={pills ? 'shrink-0' : ''}>
            <a
              href={`#${id}`}
              aria-current={active === id ? 'true' : undefined}
              onClick={(event) => {
                event.preventDefault();
                window.history.replaceState(null, '', `#${id}`);
                onSelect(id);
              }}
              className={itemClass(active === id, pills)}
            >
              {Icon && <Icon size={pills ? 14 : 18} className="shrink-0" />}
              {label}
            </a>
          </li>
        ))}
        {timelineTo && (
          <li className={pills ? 'shrink-0' : 'pt-2 mt-2 border-t border-slate-200'}>
            <Link to={timelineTo} className={itemClass(false, pills)}>
              <History size={pills ? 14 : 18} className="shrink-0" /> Timeline
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
};

export default RecordNav;
