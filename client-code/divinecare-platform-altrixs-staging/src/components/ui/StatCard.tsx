import type { ReactNode } from 'react';
import Link from 'next/link';
import { cx, FOCUS_RING, SURFACE, TONE_SOFT, type Tone } from './tokens';

/**
 * KPI tile. White card, neutral label, large tabular number; colour lives only in the
 * small icon chip (tone) so a row of KPIs reads as one system. `href` makes it a link.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  href,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  href?: string;
  className?: string;
}) {
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-slate-600">{label}</p>
        <p className="stat-number mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </div>
      {icon ? (
        <span
          aria-hidden
          className={cx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset [&>svg]:h-[18px] [&>svg]:w-[18px]',
            TONE_SOFT[tone],
          )}
        >
          {icon}
        </span>
      ) : null}
    </div>
  );
  if (href) {
    return (
      <Link
        href={href}
        className={cx(SURFACE, 'block p-4 transition hover:border-slate-300 hover:shadow-sm', FOCUS_RING, className)}
      >
        {body}
      </Link>
    );
  }
  return <div className={cx(SURFACE, 'p-4', className)}>{body}</div>;
}

const LG_COLS = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' } as const;

/** Responsive KPI row: 1 column on phones, 2 on tablets, `columns` on desktop. */
export function StatGrid({ children, columns = 4 }: { children: ReactNode; columns?: 2 | 3 | 4 | 5 }) {
  return <div className={cx('grid grid-cols-1 gap-4 sm:grid-cols-2', LG_COLS[columns])}>{children}</div>;
}
