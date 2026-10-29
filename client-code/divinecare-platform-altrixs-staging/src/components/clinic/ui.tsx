/**
 * Legacy clinic chrome (kept for existing pages, no visual change).
 * New and converted pages use the design-system primitives in `@/components/ui`
 * (PageHeader, StatCard, StatusBadge, Card, EmptyState); see docs/design-system.md.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';

export function PageHeader({
  eyebrow = 'Altrixs · Clinical',
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {eyebrow}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-[1.65rem]">{title}</h1>
        {description ? <p className="mt-1 text-[13px] text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type RoleHubQuickLink = {
  href: string;
  label: string;
};

/** Role home chrome — header + optional quick links. Does not replace page body. */
export function RoleHubHeader({
  eyebrow,
  title,
  description,
  actions,
  links,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  links?: RoleHubQuickLink[];
}) {
  return (
    <div className="space-y-2.5">
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {links && links.length > 0 ? (
        <div className="clinic-card flex flex-wrap gap-2 p-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'blue',
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'slate';
  /** Optional decorative icon (e.g. a Lucide icon element); hidden from screen readers */
  icon?: ReactNode;
}) {
  // Text colors are 700/800 on 50 backgrounds: all clear WCAG AA contrast.
  const tones = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-800',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    violet: 'bg-violet-50 text-violet-700',
    slate: 'bg-slate-100 text-slate-600',
  } as const;

  return (
    <div className="clinic-card px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-[1.45rem] font-semibold tracking-tight text-slate-900">{value}</p>
          {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
        </div>
        {icon ? (
          <span
            aria-hidden
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tones[tone]}`}
          >
            {icon}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Panel({
  children,
  className = '',
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div className={`clinic-card ${padding ? 'p-4 sm:p-5' : ''} ${className}`.trim()}>{children}</div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-[13px] font-semibold text-slate-800">{title}</p>
      {description ? <p className="mt-1 text-[13px] text-slate-500">{description}</p> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'slate' | 'blue' | 'green' | 'amber' | 'rose' | 'violet';
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    green: 'bg-blue-50 text-blue-700 ring-blue-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  } as const;
  return (
    <span className={`clinic-badge ring-1 ring-inset ${tones[tone]}`}>{children}</span>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center lg:px-5">
      {children}
    </div>
  );
}
