import { createContext, useContext } from 'react';

export const ConfirmContext = createContext(null);

// const { confirm, askReason } = useConfirm();
//   if (!(await confirm({ title: 'Delete it?', message: '...', confirmLabel: 'Delete' }))) return;
//   const reason = await askReason({ title: 'Void it?', reason: { label: 'Reason (optional)' } });  // null = cancelled
export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return context;
}
