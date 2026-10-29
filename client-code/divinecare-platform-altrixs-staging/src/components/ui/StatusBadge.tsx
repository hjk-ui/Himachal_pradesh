import type { ReactNode } from 'react';
import { cx, TONE_DOT, TONE_SOFT, type Tone } from './tokens';

/**
 * Semantic status pill. Pick the tone by meaning, never by taste:
 * success = done/active/paid, warning = needs attention/pending, danger = failed/overdue/high risk,
 * info = in progress/scheduled, brand = feature/role labels, neutral = draft/inactive/unknown.
 */
export function StatusBadge({
  tone = 'neutral',
  children,
  dot = false,
  icon,
  size = 'md',
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs',
        TONE_SOFT[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone])} /> : null}
      {icon ? (
        <span aria-hidden className="inline-flex [&>svg]:h-3.5 [&>svg]:w-3.5">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  active: 'success',
  approved: 'success',
  paid: 'success',
  signed: 'success',
  completed: 'success',
  complete: 'success',
  accepted: 'success',
  verified: 'success',
  eligible: 'success',
  resolved: 'success',
  pending: 'warning',
  unsigned: 'warning',
  'needs review': 'warning',
  medium: 'warning',
  moderate: 'warning',
  submitted: 'info',
  scheduled: 'info',
  'in progress': 'info',
  'checked in': 'info',
  open: 'info',
  denied: 'danger',
  rejected: 'danger',
  failed: 'danger',
  overdue: 'danger',
  expired: 'danger',
  'no show': 'danger',
  high: 'danger',
  critical: 'danger',
  draft: 'neutral',
  cancelled: 'neutral',
  canceled: 'neutral',
  inactive: 'neutral',
  low: 'success',
};

/** Best-effort tone for a status string (case/underscore/hyphen-insensitive); unknown values are neutral. */
export function toneForStatus(status: string | null | undefined): Tone {
  if (!status) return 'neutral';
  return STATUS_TONE[status.toLowerCase().replace(/[_-]+/g, ' ').trim()] ?? 'neutral';
}
