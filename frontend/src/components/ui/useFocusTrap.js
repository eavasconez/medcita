import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Dialogs can open on top of one another (a confirmation asked from inside a form modal):
// only the one opened last reacts to the keyboard.
const openDialogs = [];

// While `active`: moves the focus into `containerRef` (to the element marked `data-autofocus`,
// else the first focusable one), keeps Tab and Shift+Tab inside it so keyboard users cannot
// reach the page behind, calls `onEscape` on Escape, and gives the focus back to whatever
// had it before when it stops. Used by Modal and by the mobile drawer of the Sidebar.
export default function useFocusTrap(containerRef, { active = true, onEscape } = {}) {
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const token = {};
    openDialogs.push(token);
    const previouslyFocused = document.activeElement;
    const getFocusables = () => Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));

    (container.querySelector('[data-autofocus]') || getFocusables()[0] || container).focus();

    const handleKeyDown = (event) => {
      if (event.defaultPrevented || openDialogs[openDialogs.length - 1] !== token) return;
      if (event.key === 'Escape') {
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = getFocusables();
      if (focusables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!container.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      openDialogs.splice(openDialogs.indexOf(token), 1);
      if (previouslyFocused?.isConnected && previouslyFocused.focus) previouslyFocused.focus();
    };
  }, [active, containerRef]);
}
