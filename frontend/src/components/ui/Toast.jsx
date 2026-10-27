import React from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

const TONES = {
  success: { box: 'bg-success shadow-success/30', Icon: CheckCircle2, role: 'status' },
  error: { box: 'bg-danger shadow-danger/30', Icon: AlertCircle, role: 'alert' }
};

// The notice that slides in at the bottom corner. Errors are announced at once to a screen
// reader (role="alert"); successes politely.
const Toast = ({ message, type = 'success', onDismiss }) => {
  const { box, Icon, role } = TONES[type] || TONES.success;
  return (
    <div role={role} className={`toast animate-in slide-in-from-bottom-5 fade-in duration-300 ${box}`}>
      <Icon size={24} className="shrink-0" />
      <span className="text-sm">{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="ml-auto hover:opacity-75 transition-opacity">
        <X size={18} />
      </button>
    </div>
  );
};

export default Toast;
