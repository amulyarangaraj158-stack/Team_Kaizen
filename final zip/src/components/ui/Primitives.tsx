import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAppStore } from '../../store/useAppStore';

export function cn(...inputs: Array<string | undefined | null | false>) {
  return twMerge(clsx(inputs));
}

export function CircularGauge({
  value,
  label,
  sublabel,
  color = '#00F5FF',
  size = 92,
}: {
  value: number;
  label: string;
  sublabel?: string;
  color?: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(148, 163, 184, 0.16)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 450ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-lg font-bold tabular-nums text-[#F1F5F9]">{clamped}%</span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs font-medium text-[#F1F5F9]">{label}</div>
        {sublabel && <div className="text-[11px] font-mono text-[#94A3B8]">{sublabel}</div>}
      </div>
    </div>
  );
}

export function SeverityIndicator({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  if (s === 'critical') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[#FF3864]">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        Critical
      </span>
    );
  }
  if (s === 'high') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[#FFB020]">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        High
      </span>
    );
  }
  if (s === 'medium') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-[#3B82F6]">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        Medium
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-[#94A3B8]">
      <Info className="h-3.5 w-3.5 shrink-0" />
      Low
    </span>
  );
}

export function RiskText({ level }: { level: string }) {
  const l = level.toLowerCase();
  const color =
    l === 'critical'
      ? 'text-[#FF3864]'
      : l === 'high'
        ? 'text-[#FFB020]'
        : l === 'medium'
          ? 'text-[#3B82F6]'
          : 'text-[#39FF88]';
  return <span className={cn('font-mono text-xs font-semibold', color)}>{level} Risk</span>;
}

export function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="cyber-panel-elevated w-full max-w-md rounded-lg p-6 shadow-2xl">
        <h3 id="confirm-dialog-title" className="text-lg font-semibold text-[#F1F5F9]">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-[#94A3B8]">{description}</p>
        {details && details.length > 0 && (
          <div className="mt-4 rounded-md border border-[#00F5FF]/15 bg-[#070B14] p-3">
            <div className="text-xs font-medium text-[#94A3B8]">Affected files:</div>
            <ul className="mt-1.5 space-y-1 font-mono text-xs text-[#00F5FF]">
              {details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-700 bg-[#0B1220] px-4 py-2 text-sm font-medium text-[#F1F5F9] transition-colors hover:bg-[#142238] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50',
              danger
                ? 'bg-[#FF3864] text-white hover:bg-[#e12e57]'
                : 'bg-[#00F5FF] text-[#070B14] hover:bg-[#33f7ff]'
            )}
          >
            {busy ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, dismissToast } = useAppStore();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2.5 px-4 sm:px-0">
      {toasts.map((t) => {
        const icon =
          t.tone === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#39FF88]" />
          ) : t.tone === 'error' ? (
            <ShieldAlert className="h-4 w-4 shrink-0 text-[#FF3864]" />
          ) : t.tone === 'warning' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-[#FFB020]" />
          ) : (
            <Info className="h-4 w-4 shrink-0 text-[#00F5FF]" />
          );

        return (
          <div
            key={t.id}
            role="status"
            className="cyber-panel-elevated flex items-start gap-3 rounded-lg p-3.5 shadow-xl"
          >
            <div className="mt-0.5">{icon}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#F1F5F9]">{t.title}</div>
              {t.message && <p className="mt-0.5 text-xs text-[#94A3B8] line-clamp-2">{t.message}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="rounded p-1 text-[#94A3B8] hover:text-[#F1F5F9]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="cyber-panel flex flex-col items-center justify-center rounded-lg px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[#142238] text-[#00F5FF]">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-[#F1F5F9]">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-[#94A3B8]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
