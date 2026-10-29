import type { ReactNode } from 'react';
import { cx } from './tokens';

/**
 * Page container: centred, standard max width and vertical rhythm (space-y-6).
 * `width="full"` for calendars, boards and split views that need every pixel.
 */
export function Page({
  children,
  width = 'default',
  className,
}: {
  children: ReactNode;
  width?: 'default' | 'narrow' | 'full';
  className?: string;
}) {
  const max = width === 'full' ? 'max-w-none' : width === 'narrow' ? 'max-w-3xl' : 'max-w-7xl';
  return <div className={cx('mx-auto w-full min-w-0 space-y-6', max, className)}>{children}</div>;
}

/**
 * Standard page header: title (the only h1 on the page), one-line description,
 * optional badges beside the title, and actions on the right (primary action last).
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  badges,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Optional small context label above the title (e.g. area name). */
  eyebrow?: ReactNode;
  /** Status pills shown next to the title. */
  badges?: ReactNode;
  /** Buttons on the right: secondary actions first, primary action last. */
  actions?: ReactNode;
  /** Optional row under the header (filters, tabs). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx('space-y-4', className)}>
      {/* Title and actions share a row only from lg: between 640 and 1024px (and with the sidebar open) a
          row of actions would squeeze the title to nothing. Actions wrap and never take more than 60%. */}
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 lg:flex-1">
          {eyebrow ? (
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">{eyebrow}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {badges}
          </div>
          {description ? <div className="mt-1 max-w-3xl text-sm text-slate-500">{description}</div> : null}
        </div>
        {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2 lg:max-w-[60%] lg:shrink-0 lg:justify-end">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
