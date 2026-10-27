import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toast from './Toast';
import { ToastContext } from './toastContext';

const TOAST_MS = 4000;

// One toast for the whole app, drawn above the page: it survives a navigation (the patient was
// deleted and the list is already on screen) and a new one replaces the one still showing.
const ToastProvider = ({ children }) => {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const counterRef = useRef(0);

  const dismissToast = useCallback(() => {
    clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    // Without this an old timer would dismiss the newer toast early
    clearTimeout(timerRef.current);
    counterRef.current += 1;
    setToast({ id: counterRef.current, message, type });
    timerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={dismissToast} />}
    </ToastContext.Provider>
  );
};

export default ToastProvider;
