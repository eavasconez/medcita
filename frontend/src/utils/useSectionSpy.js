import { useState, useEffect, useCallback, useRef } from 'react';

const WIDE = '(min-width: 768px)'; // Tailwind's `md`: from here the record scrolls inside its own box
const MARGIN = 24; // a section counts as the current one a bit before its top reaches the edge
const GAP = 8; // what a section leaves above itself when it is scrolled to

const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

// Which section of a long page is the one being read, and how to go to one. `ids` are the ids of the
// sections in page order. From `md` up the content scrolls inside `scrollerRef` (the header and the
// navigation stay put); on a phone the whole window scrolls and the section pills (`pinnedRef`) are
// pinned under the header, so a section's top edge is the bottom of the pills.
//
// The current section is the last one whose top is above the edge; at the very bottom it is the last
// one, which can be too short to ever reach the edge. After a click the clicked section stays the
// current one until the scrolling it caused stops, so a short section near the end does not lose it
// to its neighbour on the way.
export default function useSectionSpy(ids, { scrollerRef, pinnedRef, enabled = true }) {
  const [active, setActive] = useState(ids[0]);
  const locked = useRef(false);
  const target = useRef(null); // the section a click is scrolling to
  const unlockTimer = useRef(null);
  const idsKey = ids.join('|');

  const wide = () => window.matchMedia(WIDE).matches && Boolean(scrollerRef.current);
  const edge = useCallback(() => (wide() ? scrollerRef.current.getBoundingClientRect().top : pinnedRef.current?.getBoundingClientRect().bottom ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  const scrollTo = (id, behavior) => {
    const el = document.getElementById(id);
    if (!el) return 0;
    const delta = el.getBoundingClientRect().top - edge() - GAP;
    const options = { top: delta, behavior };
    if (wide()) scrollerRef.current.scrollBy(options);
    else window.scrollBy(options);
    return delta;
  };

  const lockFor = (ms) => {
    locked.current = true;
    clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => {
      locked.current = false;
      // On a phone the header is taller until the first scroll (the breadcrumb is still there), so a
      // section measured against it lands a little low: once the scrolling stops, line it up again.
      const id = target.current;
      target.current = null;
      const el = id && document.getElementById(id);
      if (el && Math.abs(el.getBoundingClientRect().top - edge() - GAP) > 2) scrollTo(id, 'auto');
    }, ms);
  };

  useEffect(() => {
    if (!enabled) return undefined;
    const list = idsKey ? idsKey.split('|') : [];
    let frame = 0;

    const update = () => {
      frame = 0;
      if (locked.current) {
        lockFor(150); // still moving because of a click: wait until it stops
        return;
      }
      const line = edge() + MARGIN;
      let current = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      const scroller = scrollerRef.current;
      const [top, max] = wide()
        ? [scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight]
        : [window.scrollY, document.documentElement.scrollHeight - window.innerHeight];
      if (top > 0 && top >= max - 2) current = list[list.length - 1];
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const scroller = scrollerRef.current;
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      scroller?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(unlockTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idsKey]);

  // Scrolls to a section (`instant` for a link opened with a #section: no animation)
  const goTo = useCallback((id, instant = false) => {
    if (!document.getElementById(id)) return;
    setActive(id);
    target.current = id;
    lockFor(instant ? 60 : 400);
    scrollTo(id, instant ? 'auto' : smooth());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { active, goTo };
}
