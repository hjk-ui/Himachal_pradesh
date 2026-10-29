'use client';

import Link from 'next/link';
import { ExternalLink, Info } from 'lucide-react';

/** Card wrapper for a chart tab: title, scope line, "Open full list" link to the practice-wide page */
export function ChartSection({
  title,
  subtitle,
  fullListHref,
  fullListLabel = 'Open full list',
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  fullListHref?: string;
  fullListLabel?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="clinic-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h3 className="clinic-section-title">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {fullListHref ? (
            <Link href={fullListHref} className="clinic-btn-secondary inline-flex items-center gap-1.5 text-xs">
              {fullListLabel} <ExternalLink size={12} />
            </Link>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function SectionState({ loading, error, empty, emptyText }: { loading?: boolean; error?: string | null; empty?: boolean; emptyText?: string }) {
  if (error) return <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (empty) return <p className="text-sm text-slate-500">{emptyText || 'Nothing on file.'}</p>;
  return null;
}

/** States a data limitation plainly instead of guessing */
export function DataNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
      <Info size={12} className="mt-0.5 shrink-0 text-slate-500" />
      <span>{children}</span>
    </p>
  );
}

export function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'rose' | 'amber' | 'emerald' | 'purple' | 'sky' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-800',
    emerald: 'bg-emerald-50 text-emerald-700',
    purple: 'bg-purple-50 text-[#5C2D91]',
    sky: 'bg-sky-50 text-sky-700',
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
}

export const fmtDate = (v: string | null | undefined) => {
  if (!v) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const fmtDateTime = (v: string | null | undefined) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
