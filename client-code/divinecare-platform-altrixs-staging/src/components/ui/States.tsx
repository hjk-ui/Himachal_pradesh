import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import { cx } from './tokens';

/** Nothing to show yet: icon, one-line title, optional guidance and a next action. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  /** Smaller padding for use inside table bodies and small cards. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 text-center', compact ? 'py-8' : 'py-12', className)}>
      <span
        aria-hidden
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 [&>svg]:h-5 [&>svg]:w-5"
      >
        {icon ?? <Inbox />}
      </span>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

const SKELETON_WIDTHS = ['w-11/12', 'w-3/4', 'w-5/6'] as const;

/** Loading placeholder. `rows` renders skeleton lines (tables/lists); otherwise a spinner + label. */
export function LoadingState({
  label = 'Loading…',
  rows,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  if (rows && rows > 0) {
    return (
      <div role="status" aria-live="polite" className={cx('space-y-3 p-5', className)}>
        <span className="sr-only">{label}</span>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} aria-hidden className={cx('h-4 animate-pulse rounded bg-slate-100', SKELETON_WIDTHS[i % 3])} />
        ))}
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx('flex items-center justify-center gap-2 px-6 py-12 text-sm text-slate-500', className)}
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/** Load failure with a retry. Says what failed, not a stack trace. */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span aria-hidden className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-rose-700">
        <AlertCircle className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-slate-600">{description}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
