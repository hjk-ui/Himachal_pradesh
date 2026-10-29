'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeftRight, Lock, ShieldAlert } from 'lucide-react';
import { GROUP_KIND_META, PART2_REDISCLOSURE_NOTICE, type GroupKind } from '@/lib/groups/types';

export const BRAND = '#5C2D91';

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function apiBase() {
  return '/api/ehr/groups';
}

export function formatDate(ymd: string | null | undefined) {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function formatTime(hm: string | null | undefined) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Area header: which area you are in, with a clear switch to the other one (never mixed). */
export function KindHeader({ kind, title, subtitle, actions, back }: { kind: GroupKind; title?: string; subtitle?: string; actions?: ReactNode; back?: ReactNode }) {
  const meta = GROUP_KIND_META[kind];
  const other: GroupKind = kind === 'sud' ? 'psychotherapy' : 'sud';
  return (
    <header className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
      {back}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white" style={{ background: kind === 'sud' ? '#00695C' : BRAND }}>
            {meta.label}
          </p>
          <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-900">{title ?? meta.label}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Link
            href={GROUP_KIND_META[other].href}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 md:min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]"
          >
            <ArrowLeftRight size={14} aria-hidden />
            Go to {GROUP_KIND_META[other].label}
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Part2Banner({ kind }: { kind: GroupKind }) {
  if (kind !== 'sud') return null;
  return (
    <div role="note" className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
      <Lock size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">42 CFR Part 2 records</p>
        <p className="text-teal-800">
          Every SUD group, its attendance and its notes are Part 2. Do not disclose outside the SUD program without the client&apos;s written Part 2 consent. {PART2_REDISCLOSURE_NOTICE}
        </p>
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

export function Pill({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'rose' | 'purple' | 'blue' | 'teal' }) {
  const cls: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-50 text-emerald-800',
    amber: 'bg-amber-50 text-amber-800',
    rose: 'bg-rose-50 text-rose-800',
    purple: 'bg-purple-50 text-purple-800',
    blue: 'bg-blue-50 text-blue-800',
    teal: 'bg-teal-50 text-teal-800',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls[tone]}`}>{children}</span>;
}

export const SESSION_STATUS_TONE: Record<string, 'slate' | 'amber' | 'green' | 'rose'> = {
  scheduled: 'slate',
  in_progress: 'amber',
  completed: 'green',
  cancelled: 'rose',
};

export const SESSION_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4A2475] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryBtn = 'clinic-btn-secondary gap-2';
