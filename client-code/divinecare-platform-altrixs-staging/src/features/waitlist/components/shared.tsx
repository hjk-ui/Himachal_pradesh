'use client';

import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cx } from '@/components/ui';
import {
  CLOSE_REASON_LABEL,
  CONTACT_METHODS,
  CONTACT_OUTCOMES,
  CRISIS_GUIDANCE,
  STAGE_LABEL,
} from '@/lib/waitlist/standard';
import type { WaitlistStage, WaitlistUrgency } from '@/features/waitlist/api';

export const METHOD_LABEL: Record<string, string> = Object.fromEntries(CONTACT_METHODS);
export const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(CONTACT_OUTCOMES);

/** Right-side panel on desktop, full-screen sheet on phones. No horizontal scroll. */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end overflow-hidden bg-slate-900/40" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close panel" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className={cx('relative z-10 flex h-full w-full flex-col bg-white shadow-xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-xl')}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">{children}</div>
        {footer ? <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">{footer}</div> : null}
      </div>
    </div>
  );
}

export function UrgencyBadge({ urgency, safety }: { urgency: WaitlistUrgency; safety?: string | null }) {
  const cls =
    urgency === 'crisis'
      ? 'bg-rose-100 text-rose-800'
      : urgency === 'urgent'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-slate-100 text-slate-600';
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize', cls)}>{urgency}</span>
      {safety === 'yes' ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-700 px-2 py-0.5 text-[11px] font-semibold text-white">
          <AlertTriangle size={11} aria-hidden /> Safety
        </span>
      ) : safety === 'not_asked' || !safety ? (
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500" title="Safety screen not asked yet">
          Screen due
        </span>
      ) : null}
    </span>
  );
}

const STAGE_CLS: Record<string, string> = {
  NEW: 'bg-blue-50 text-blue-700',
  CONTACTED: 'bg-indigo-50 text-indigo-700',
  INTAKE_SENT: 'bg-violet-50 text-violet-700',
  READY: 'bg-amber-50 text-amber-800',
  SCHEDULED: 'bg-emerald-50 text-emerald-700',
  CONVERTED: 'bg-emerald-50 text-emerald-700',
  CLOSED: 'bg-slate-100 text-slate-600',
};

export function StageBadge({ stage, closeReason }: { stage: WaitlistStage; closeReason?: string | null }) {
  return (
    <span className={cx('inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold', STAGE_CLS[stage])}>
      {STAGE_LABEL[stage] ?? stage}
      {stage === 'CLOSED' && closeReason ? `: ${CLOSE_REASON_LABEL[closeReason] ?? closeReason}` : ''}
    </span>
  );
}

/** 988 / same-day triage guidance shown whenever the safety screen is "yes". */
export function CrisisGuidance({ className }: { className?: string }) {
  return (
    <div className={cx('rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900', className)} role="alert">
      <p className="flex items-center gap-2 font-bold">
        <AlertTriangle size={16} aria-hidden /> Positive safety screen: do not leave this person waiting
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {CRISIS_GUIDANCE.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs">The entry is marked Urgent and moved to the top of the waitlist.</p>
    </div>
  );
}

export function formatDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions, timeZone?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(opts ?? {}), ...(timeZone ? { timeZone } : {}) });
}

export function formatDateTime(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

/** Date-only (YYYY-MM-DD) shown without a time-zone shift. */
export function formatYmd(ymd: string | null | undefined) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cx('block min-w-0', className)}>
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-slate-500 first:mt-0">{children}</h3>;
}

export function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}
