import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X, Loader2 } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        const Icon =
          t.type === 'success'
            ? CheckCircle2
            : t.type === 'error'
              ? XCircle
              : t.type === 'warning'
                ? AlertTriangle
                : Info;
        const iconColor =
          t.type === 'success'
            ? 'text-emerald-400'
            : t.type === 'error'
              ? 'text-red-400'
              : t.type === 'warning'
                ? 'text-amber-400'
                : 'text-blue-400';

        return (
          <div
            key={t.id}
            className="pointer-events-auto bg-[#0F172A]/95 backdrop-blur-md border border-[#1E2B4A] rounded-lg px-4 py-3 shadow-xl flex items-start gap-3"
          >
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-100">{t.title}</p>
              {t.description && <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{t.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="text-slate-500 hover:text-slate-200 transition-colors p-0.5"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  state,
  onClose,
  busy,
}: {
  state: ConfirmDialogState | null;
  onClose: () => void;
  busy?: boolean;
}) {
  if (!state?.open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0E1526] border border-[#1E2B4A] rounded-xl max-w-md w-full p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-100 font-display">{state.title}</h3>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">{state.message}</p>
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 bg-[#151F38] hover:bg-[#1E2B4A] rounded-lg transition-colors whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              await state.onConfirm();
              onClose();
            }}
            className={`px-4 py-2 text-xs font-medium text-white rounded-lg transition-colors whitespace-nowrap flex items-center gap-2 ${
              state.destructive
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {state.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="border border-dashed border-[#1E2B4A] rounded-xl bg-[#0B1120]/60 px-6 py-12 text-center max-w-xl mx-auto my-8">
      {icon && <div className="w-10 h-10 rounded-lg bg-[#151F38] text-blue-400 flex items-center justify-center mx-auto mb-4">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-100 font-display">{title}</h3>
      <p className="text-sm text-slate-400 mt-2 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function LoadingPanel({ message = 'Loading workspace data...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
