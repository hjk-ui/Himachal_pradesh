/** Shared table / filter bar layout tokens (Oct 25). */

/** Horizontal scroll wrapper — use with `.clinic-scroll-x` in className. */
export const TABLE_SCROLL = 'clinic-scroll-x overflow-x-auto';

/** Sticky first column on wide tables. */
export const TABLE_STICKY_FIRST =
  'sticky left-0 z-[1] bg-white shadow-[1px_0_0_0_#E2E8F0]';

/** Sticky trailing actions column. */
export const TABLE_STICKY_ACTIONS =
  'sticky right-0 z-[1] bg-white shadow-[-1px_0_0_0_#E2E8F0]';

export const FILTER_BAR = 'flex flex-wrap items-center gap-2 min-w-0';
export const FILTER_SEARCH =
  'h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 md:max-w-xs';
export const FILTER_SELECT =
  'h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';

/**
 * Ignore row-click when the event originated from interactive controls
 * or an explicit row-actions region.
 */
export function isRowClickTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-row-actions]')) return false;
  if (target.closest('a,button,input,select,textarea,label,[role="menuitem"]')) return false;
  const sel = typeof window !== 'undefined' ? window.getSelection()?.toString() : '';
  if (sel && sel.length > 0) return false;
  return true;
}
