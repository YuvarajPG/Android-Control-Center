import React, { useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useAppStore, ToastNotification } from '../../store/useAppStore';
import { cn } from '../../utils/cn';

const DEFAULT_TOAST_DURATION = 3500; // 3.5 seconds auto dismiss

const ToastItem: React.FC<{ toast: ToastNotification }> = ({ toast }) => {
  const { removeToast } = useAppStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      removeToast(toast.id);
    }, toast.durationMs || DEFAULT_TOAST_DURATION);

    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, removeToast]);

  const icons = {
    info: <Info className="h-4 w-4 text-m3-primary shrink-0" />,
    success: <CheckCircle2 className="h-4 w-4 text-m3-success shrink-0" />,
    warning: <AlertTriangle className="h-4 w-4 text-m3-warning shrink-0" />,
    error: <AlertCircle className="h-4 w-4 text-m3-error shrink-0" />,
  };

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 bg-m3-surface-3 border border-m3-surface-5 rounded-m3-md shadow-m3-2 text-sm text-m3-on-surface animate-in slide-in-from-bottom-5 duration-200 transition-all',
      )}
    >
      <div className="flex items-center gap-2.5">
        {icons[toast.type]}
        <span className="text-xs font-medium">{toast.message}</span>
      </div>
      <button
        onClick={() => removeToast(toast.id)}
        className="text-m3-on-surface-variant hover:text-m3-on-surface transition-colors p-0.5 rounded"
        title="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts } = useAppStore();

  if (toasts.length === 0) return null;

  // Show at most 4 recent toasts to prevent cluttering
  const visibleToasts = toasts.slice(-4);

  return (
    <div className="fixed bottom-10 right-6 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {visibleToasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
};
