import React, { useId, useState } from 'react';
import { AlertTriangle, CircleHelp } from 'lucide-react';
import Modal from './Modal';

// A question with two answers, in place of window.confirm. `tone="danger"` is for what cannot be
// undone: the focus starts on Cancel. With `reason` ({ label, placeholder }) it also asks for
// a text and passes it to `onConfirm`, in place of window.prompt.
const ConfirmDialog = ({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger', reason, onConfirm, onCancel }) => {
  const [text, setText] = useState('');
  const titleId = useId();
  const reasonId = useId();
  const danger = tone === 'danger';
  const Icon = danger ? AlertTriangle : CircleHelp;

  return (
    <Modal onClose={onCancel} labelledBy={titleId} size="sm" panelClassName="p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className={`shrink-0 w-12 h-12 rounded-control flex items-center justify-center ${danger ? 'bg-danger-soft text-danger' : 'bg-primary/10 text-primary'}`}>
          <Icon size={24} />
        </span>
        <div className="min-w-0">
          <h3 id={titleId} className="text-lg font-black text-secondary leading-snug">{title}</h3>
          {message && <p className="mt-1 text-sm font-medium text-slate-500">{message}</p>}
        </div>
      </div>

      {reason && (
        <div className="mt-5">
          <label htmlFor={reasonId} className="form-label">{reason.label}</label>
          <textarea
            id={reasonId}
            data-autofocus=""
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={reason.placeholder}
            rows={3}
            className="form-input font-medium resize-none"
          />
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
        <button
          type="button"
          data-autofocus={danger && !reason ? '' : undefined}
          onClick={onCancel}
          className="px-6 py-3 rounded-control bg-slate-100 text-slate-600 font-black text-sm hover:bg-slate-200 transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          data-autofocus={!danger && !reason ? '' : undefined}
          onClick={() => onConfirm(reason ? text.trim() : undefined)}
          className={`px-6 py-3 rounded-control text-white font-black text-sm shadow-lg transition-all hover:brightness-95 ${danger ? 'bg-danger shadow-danger/30' : 'bg-primary shadow-primary/30'}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;
