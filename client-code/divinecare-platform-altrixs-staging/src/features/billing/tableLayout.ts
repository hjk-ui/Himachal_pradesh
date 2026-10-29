/**
 * Shared table layout classes for billing worklists.
 *
 * Wide billing tables scroll horizontally inside an `overflow-x-auto` wrapper; these keep the
 * identifying first column and the row actions visible while the middle columns scroll, so the
 * actions never end up clipped off the right edge (sidebar open on a laptop, or a phone).
 * Rows that hover need `group` on the <tr> so the sticky cells follow the hover colour.
 */

/** Scroll wrapper for any billing table (use inside cards that are `overflow-hidden`). */
export const TABLE_SCROLL = 'clinic-scroll-x overflow-x-auto';

/** Sticky first column: header cell. */
export const STICKY_FIRST_TH = 'sticky left-0 z-10 bg-slate-50';
/** Sticky first column: body cell (row needs `group`). */
export const STICKY_FIRST_TD = 'sticky left-0 z-10 bg-white group-hover:bg-slate-50';

/** Sticky actions column on the right: header cell. */
export const STICKY_ACTIONS_TH = 'sticky right-0 z-10 bg-slate-50 shadow-[inset_1px_0_0_0_rgb(226,232,240)]';
/** Sticky actions column on the right: body cell (row needs `group`). */
export const STICKY_ACTIONS_TD = 'sticky right-0 z-10 bg-white shadow-[inset_1px_0_0_0_rgb(226,232,240)] group-hover:bg-slate-50';

/**
 * Filter bars: search on its own full-width row on phones; from sm up it shares the row with a
 * sensible minimum width (16rem) and the selects wrap to the next line instead of squeezing it.
 */
export const FILTER_BAR = 'flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center';
/** Wrapper for the search input (relative, for the leading icon). */
export const FILTER_SEARCH = 'relative w-full min-w-0 sm:min-w-[16rem] sm:flex-[1_1_20rem]';
/** Filter selects: full width on phones, content width (capped) from sm up. */
export const FILTER_SELECT = 'w-full sm:w-auto sm:max-w-[16rem]';
