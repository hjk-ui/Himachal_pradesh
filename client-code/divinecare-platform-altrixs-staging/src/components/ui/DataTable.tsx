import type { ReactNode } from 'react';
import { EmptyState, ErrorState, LoadingState } from './States';
import { cx } from './tokens';
import { isRowClickTarget } from './rowClick';

export type DataTableColumn<T> = {
  /** Stable key; also used as the default accessor when `cell` is omitted. */
  key: string;
  header: ReactNode;
  /** Cell renderer. Defaults to String(row[key]). */
  cell?: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Tailwind width class, e.g. 'w-32'. */
  width?: string;
  /** Hide below the md breakpoint (keep the 2-3 most important columns on phones). */
  hideOnMobile?: boolean;
  /** Hide below a wider breakpoint (secondary columns on tablets / narrow desktops). Overrides hideOnMobile. */
  hideBelow?: 'md' | 'lg' | 'xl';
  className?: string;
};

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/**
 * Simple typed table: sticky-free, comfortable density (py-3), slate header, row hover,
 * horizontal scroll on narrow screens, and built-in loading / error / empty states.
 * Pagination and sorting stay with the caller; pass `footer` for a pager.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  empty,
  onRowClick,
  caption,
  footer,
  density = 'comfortable',
  className,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  /** Empty-state node, or a string used as the EmptyState title. */
  empty?: ReactNode;
  /** Makes rows clickable. Rows still need a real link/button inside for keyboard users. */
  onRowClick?: (row: T) => void;
  /** Screen-reader caption describing the table. */
  caption?: string;
  footer?: ReactNode;
  density?: 'comfortable' | 'compact';
  className?: string;
}) {
  const pad = density === 'compact' ? 'px-4 py-2' : 'px-4 py-3';
  const HIDE_BELOW = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' } as const;
  const hide = (c: DataTableColumn<T>) => (c.hideBelow ? HIDE_BELOW[c.hideBelow] : c.hideOnMobile ? HIDE_BELOW.md : '');

  let body: ReactNode = null;
  if (loading && rows.length === 0) {
    body = <LoadingState rows={4} />;
  } else if (error) {
    body = <ErrorState description={error} onRetry={onRetry} />;
  } else if (rows.length === 0) {
    body = typeof empty === 'string' || !empty ? <EmptyState compact title={empty || 'No records yet'} /> : empty;
  }

  return (
    <div className={cx('min-w-0', className)}>
      <div className="clinic-scroll-x">
        <table className="w-full min-w-full border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cx(
                    'whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600',
                    ALIGN[c.align ?? 'left'],
                    c.width,
                    hide(c),
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          {body ? null : (
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  // Clicks on links, buttons, inputs and menus inside the row keep their own behaviour.
                  onClick={onRowClick ? (e) => isRowClickTarget(e) && onRowClick(row) : undefined}
                  className={cx('transition-colors hover:bg-slate-50', onRowClick ? 'cursor-pointer' : '')}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cx(pad, 'align-middle text-slate-700', ALIGN[c.align ?? 'left'], hide(c), c.className)}
                    >
                      {c.cell ? c.cell(row, i) : String((row as Record<string, unknown>)[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {body}
      {footer ? <div className="border-t border-slate-200 px-4 py-3">{footer}</div> : null}
    </div>
  );
}
