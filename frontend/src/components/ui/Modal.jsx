import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import useFocusTrap from './useFocusTrap';

const SIZES = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-3xl' };

// The page behind does not scroll while a dialog is open (counted: dialogs can stack)
let scrollLocks = 0;
const lockScroll = () => {
  scrollLocks += 1;
  document.body.style.overflow = 'hidden';
};
const unlockScroll = () => {
  scrollLocks -= 1;
  if (scrollLocks === 0) document.body.style.overflow = '';
};

// The one dialog of the app: a panel over a dimmed page that closes with Escape, keeps the
// keyboard inside, and gives the focus back to what opened it. The caller renders it only
// while it is open and decides what closing means (`onClose`). Clicking outside does NOT close
// it unless `closeOnOverlayClick` is set, so a half-filled form is not lost by a stray click.
// Give it a name: `label` (text) or `labelledBy` (id of the title inside).
const Modal = ({ onClose, label, labelledBy, size, overlayClassName = '', panelClassName = '', closeOnOverlayClick = false, children }) => {
  const panelRef = useRef(null);
  useFocusTrap(panelRef, { onEscape: onClose });

  useEffect(() => {
    lockScroll();
    return unlockScroll;
  }, []);

  const handleMouseDown = (event) => {
    if (closeOnOverlayClick && event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <div className={`modal-overlay ${overlayClassName}`} onMouseDown={handleMouseDown}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`modal-panel animate-in zoom-in-95 duration-200 ${SIZES[size] || ''} ${panelClassName}`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};

export default Modal;
