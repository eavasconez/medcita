import { createContext, useContext } from 'react';

export const ToastContext = createContext(null);

// const { showToast } = useToast();  showToast('Saved'); showToast('Could not save', 'error');
// `showToast` keeps the same identity between renders, so it is safe in effect dependencies.
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
