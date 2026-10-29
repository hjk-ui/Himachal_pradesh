import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cx, TONE_BANNER, TONE_ICON, type Tone } from './tokens';

const DEFAULT_ICON: Record<Tone, ReactNode> = {
  neutral: <Info />,
  brand: <Info />,
  info: <Info />,
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  danger: <XCircle />,
};

/**
 * Inline banner for page/section messages. danger and warning announce to screen readers
 * (role="alert"); others are polite status messages.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  icon,
  actions,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode | false;
  actions?: ReactNode;
  className?: string;
}) {
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cx('flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start', TONE_BANNER[tone], className)}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon === false ? null : (
          <span aria-hidden className={cx('mt-0.5 inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4', TONE_ICON[tone])}>
            {icon ?? DEFAULT_ICON[tone]}
          </span>
        )}
        <div className="min-w-0">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? <div className={cx(title ? 'mt-0.5' : '', 'opacity-90')}>{children}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
