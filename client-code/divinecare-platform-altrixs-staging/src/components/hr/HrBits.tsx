'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Search, Sparkles } from 'lucide-react';
import { StatusBadge, cx, inputClasses, type Tone } from '@/components/ui';
import { fmtDate } from './hrClient';

export type ExpiryStatusKey = 'current' | 'due_60' | 'due_30' | 'expired' | 'missing' | 'no_expiry' | 'not_required';

const EXPIRY: Record<ExpiryStatusKey, { label: string; tone: Tone }> = {
  current: { label: 'Current', tone: 'success' },
  due_60: { label: 'Due in 60 days', tone: 'warning' },
  due_30: { label: 'Due in 30 days', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
  missing: { label: 'Missing', tone: 'danger' },
  no_expiry: { label: 'No expiry', tone: 'neutral' },
  not_required: { label: 'Not required', tone: 'neutral' },
};

/** One status pill for every dated HR item (credentials, trainings, checks, documents). */
export function ExpiryBadge({ status, dueOn, daysLeft, size = 'md' }: { status: string; dueOn?: string | null; daysLeft?: number | null; size?: 'sm' | 'md' }) {
  const cfg = EXPIRY[(status as ExpiryStatusKey) in EXPIRY ? (status as ExpiryStatusKey) : 'no_expiry'];
  let label = cfg.label;
  if ((status === 'due_30' || status === 'due_60') && daysLeft != null) label = `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  if (status === 'expired' && daysLeft != null) label = `Expired ${Math.abs(daysLeft)}d ago`;
  return (
    <span title={dueOn ? `Due ${fmtDate(dueOn)}` : undefined}>
      <StatusBadge tone={cfg.tone} dot size={size}>
        {label}
      </StatusBadge>
    </span>
  );
}

/** Label / value pair for read views. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-900">{children ?? '—'}</dd>
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>;
}

export function Initials({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200"
    >
      {initials || '?'}
    </span>
  );
}

export function PersonLink({ userId, name, sub }: { userId: string; name: string; sub?: ReactNode }) {
  return (
    <Link href={`/dashboard/hr/people/${userId}`} className="group flex min-w-0 items-center gap-2.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
      <Initials name={name} size={32} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900 group-hover:text-blue-700">{name}</span>
        {sub ? <span className="block truncate text-xs text-slate-500">{sub}</span> : null}
      </span>
    </Link>
  );
}

/**
 * Filter bar: search on its own row on phones; from sm up the search keeps at least 16rem and the
 * selects / toggles wrap to the next line instead of squeezing it.
 */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>{children}</div>;
}

/** Search box sized for FilterBar. */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx('relative w-full min-w-0 sm:min-w-[16rem] sm:flex-[1_1_20rem]', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClasses, 'pl-9')}
      />
    </div>
  );
}

/** Select sized for FilterBar: full width on phones, natural width from sm up. */
export const FILTER_SELECT = 'w-full sm:w-44 sm:shrink-0';

/** Native input / select / textarea with the design-system classes. */
export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClasses, props.className)} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClasses, props.className)} />;
}
export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClasses, 'min-h-[96px]', props.className)} />;
}

export function Labeled({ label, hint, children, required }: { label: string; hint?: ReactNode; children: ReactNode; required?: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

/** "Practice policy, confirm" marker for settings that carry regulatory numbers. */
export function PolicyConfirm({ children = 'Practice policy, confirm' }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">{children}</span>
  );
}

/** Marks AI output: always a draft for a person to review. */
export function AiDraftNotice({ engine, disclaimer }: { engine: 'bedrock' | 'rules'; disclaimer: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">{engine === 'bedrock' ? 'AI draft' : 'Template draft'}.</strong> {disclaimer} Nothing is saved until you save it.
      </span>
    </div>
  );
}

export function ProgressBar({ pct, tone = 'brand', label }: { pct: number; tone?: 'brand' | 'success' | 'warning' | 'danger'; label?: string }) {
  const color = tone === 'success' ? 'bg-emerald-500' : tone === 'warning' ? 'bg-amber-500' : tone === 'danger' ? 'bg-rose-500' : 'bg-blue-600';
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-2 min-w-[60px] flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${v}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-slate-600">{v}%</span>
    </div>
  );
}
