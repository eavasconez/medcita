import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Shown when a screen could not load its data. Without it a failed request looks
// exactly like "there is nothing here" (0 appointments, "No patients found"),
// which sends people to look for data that is only temporarily out of reach.
const LoadError = ({ message, onRetry }) => (
  <div role="alert" className="py-12 px-6 text-center bg-danger-soft rounded-3xl border-2 border-dashed border-danger-line">
    <AlertTriangle className="mx-auto text-danger/70 w-12 h-12 mb-3" />
    <p className="text-danger-ink font-bold text-lg">{message}</p>
    <p className="text-danger/70 mt-1 text-sm">This is a problem loading the data, not an empty list. Please try again in a moment.</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white border border-danger-line text-danger-ink font-bold text-sm hover:bg-danger-soft transition-colors"
      >
        <RefreshCw size={16} /> Try again
      </button>
    )}
  </div>
);

export default LoadError;
