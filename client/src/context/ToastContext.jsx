import { createContext, useContext, useCallback, useMemo, useState, useRef } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(({ type = 'success', title, message, duration = 4000 }) => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-4), { id, type, title, message }]);
    const timer = setTimeout(() => dismiss(id), duration);
    timers.current.set(id, timer);
    return id;
  }, [dismiss]);

  const toast = useMemo(
    () => ({
      success: (title, message) => push({ type: 'success', title, message }),
      error: (title, message) => push({ type: 'error', title, message, duration: 6000 }),
      warn: (title, message) => push({ type: 'warning', title, message, duration: 5000 }),
      info: (title, message) => push({ type: 'info', title, message }),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }) {
  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
    error: <XCircle className="h-5 w-5 text-rose-400" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-400" />,
    info: <Info className="h-5 w-5 text-sky-400" />,
  };
  const bars = {
    success: 'bg-emerald-400',
    error: 'bg-rose-400',
    warning: 'bg-amber-400',
    info: 'bg-sky-400',
  };

  return (
    <div
      className="pointer-events-auto animate-slide-up overflow-hidden rounded-xl border border-white/10 bg-base-800/95 shadow-2xl shadow-black/40 backdrop-blur"
      role="status"
    >
      <div className={cn('h-0.5 w-full', bars[toast.type])} />
      <div className="flex items-start gap-3 p-3.5">
        <div className="mt-0.5 shrink-0">{icons[toast.type]}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">{toast.title}</p>
          {toast.message && <p className="mt-0.5 break-words text-xs text-slate-400">{toast.message}</p>}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
