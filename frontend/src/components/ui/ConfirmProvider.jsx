import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { ConfirmContext } from './confirmContext';

// Holds the confirmation dialog of the whole app and answers `confirm()` / `askReason()` with a
// promise, so a handler reads like it did with window.confirm: `if (!(await confirm({...}))) return;`
// `confirm` resolves true or false; `askReason` resolves the text (maybe empty) or null if cancelled.
const ConfirmProvider = ({ children }) => {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);
  const counterRef = useRef(0);

  const settle = useCallback((value) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setRequest(null);
  }, []);

  const ask = useCallback((options) => new Promise((resolve) => {
    // A new question cancels the one still open
    resolverRef.current?.(null);
    resolverRef.current = resolve;
    counterRef.current += 1;
    setRequest({ id: counterRef.current, options });
  }), []);

  const confirm = useCallback(async (options) => (await ask(options)) !== null, [ask]);
  const askReason = useCallback((options) => ask({ ...options, reason: options.reason || { label: 'Reason' } }), [ask]);

  // Nobody is left waiting if the provider goes away with a question open
  useEffect(() => () => resolverRef.current?.(null), []);

  const value = useMemo(() => ({ confirm, askReason }), [confirm, askReason]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request && (
        <ConfirmDialog
          key={request.id}
          {...request.options}
          onConfirm={(text) => settle(request.options.reason ? text : true)}
          onCancel={() => settle(null)}
        />
      )}
    </ConfirmContext.Provider>
  );
};

export default ConfirmProvider;
