'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Bookmark, Filter, RotateCcw, Search, Trash2, User, EyeOff, X } from 'lucide-react';
import { buttonClasses, IconButton } from '@/components/ui';
import {
  FILTER_STATUSES,
  FILTER_STATUS_LABEL,
  PROGRAMS,
  PROGRAM_LABEL,
  QUICK_FILTERS,
  QUICK_FILTER_LABEL,
  VISIT_MODES,
  VISIT_MODE_LABEL,
  activeChips,
  activeFilterCount,
  emptyFilters,
  removeChip,
  toggleValue,
  type SavedView,
  type ScheduleFilters,
} from '@/features/appointments/filters';

export type FilterOption = { value: string; label: string; count?: number; color?: string; textColor?: string; /** heading the option is listed under (Provider: role group) */ group?: string };

export type ScheduleFilterOptions = {
  providers: FilterOption[];
  locations: FilterOption[];
  types: FilterOption[];
  labels: FilterOption[];
  payers: FilterOption[];
};

function pressedCls(on: boolean) {
  return on
    ? 'border-blue-600 bg-blue-50 text-blue-700'
    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
}

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1';

/** One checkbox group (fieldset + legend); optional search box for long lists. */
function CheckGroup({
  legend,
  options,
  selected,
  onChange,
  searchable,
  emptyText = 'None in this range',
}: {
  legend: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  emptyText?: string;
}) {
  const [q, setQ] = useState('');
  const searchId = useId();
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
    // Keep picked values visible even when the visible range no longer has them
    const missing = selected.filter((v) => !options.some((o) => o.value === v)).map((v): FilterOption => ({ value: v, label: v, count: 0 }));
    return [...list, ...(needle ? [] : missing)];
  }, [options, q, selected]);
  return (
    <fieldset className="min-w-0">
      <legend className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        <span>{legend}</span>
        {selected.length ? (
          <button type="button" onClick={() => onChange([])} className={`rounded px-1 text-[11px] font-semibold normal-case tracking-normal text-blue-700 hover:underline ${focusRing}`}>
            Clear ({selected.length})
          </button>
        ) : null}
      </legend>
      {searchable ? (
        <div className="mt-2">
          <label htmlFor={searchId} className="sr-only">Search {legend.toLowerCase()}</label>
          <input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${legend.toLowerCase()}`}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>
      ) : null}
      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
        {shown.length === 0 ? <p className="text-xs text-slate-500">{q ? 'No match' : emptyText}</p> : null}
        {shown.map((o, i) => {
          const on = selected.includes(o.value);
          const heading = o.group && o.group !== shown[i - 1]?.group ? o.group : null;
          return (
            <Fragment key={o.value}>
            {heading ? (
              <p className="px-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 first:pt-0">{heading}</p>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs text-slate-800 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(toggleValue(selected, o.value))}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              {o.color ? (
                <span aria-hidden className="h-2.5 w-2.5 flex-shrink-0 rounded-full border border-black/10" style={{ backgroundColor: o.color }} />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.count != null ? <span className="text-[11px] tabular-nums text-slate-500">{o.count}</span> : null}
            </label>
            </Fragment>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Scheduler filter bar: client search, "My schedule" and "Hide cancelled / no-shows" toggles,
 * quick chips, the Filters panel (inline on desktop, a sheet on phones), active-filter chips,
 * saved views and an aria-live shown / total count.
 */
export function ScheduleFilterBar({
  filters,
  onChange,
  options,
  canUseMine,
  shown,
  total,
  rangeText,
  savedViews,
  onSaveView,
  onApplyView,
  onDeleteView,
  onReset,
  isDefault,
  note,
  onJumpToMatch,
}: {
  filters: ScheduleFilters;
  onChange: (next: ScheduleFilters) => void;
  options: ScheduleFilterOptions;
  canUseMine: boolean;
  shown: number;
  total: number;
  rangeText: string;
  savedViews: SavedView[];
  onSaveView: (name: string) => void;
  onApplyView: (view: SavedView) => void;
  onDeleteView: (name: string) => void;
  onReset: () => void;
  isDefault: boolean;
  /** Info line under the bar (e.g. how the header location switcher applies) */
  note?: string | null;
  /** Shown while a client search is active: jump the calendar to the next matching visit */
  onJumpToMatch?: ((q?: string) => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const panelId = useId();
  const searchId = useId();
  const viewNameId = useId();
  const filtersBtn = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [qDraft, setQDraft] = useState(filters.q);

  // Debounce the client search into the filters (URL / storage writes stay cheap)
  useEffect(() => setQDraft(filters.q), [filters.q]);
  useEffect(() => {
    if (qDraft === filters.q) return;
    const t = setTimeout(() => onChange({ ...filters, q: qDraft }), 250);
    return () => clearTimeout(t);
  }, [qDraft, filters, onChange]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        filtersBtn.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const lookup = (list: FilterOption[]) => (id: string) => list.find((o) => o.value === id)?.label;
  const chips = activeChips(filters, {
    provider: lookup(options.providers),
    location: lookup(options.locations),
    label: lookup(options.labels),
  });
  // The two always-visible toggles have their own buttons; chips list the rest
  const panelCount = activeFilterCount(filters) - (filters.mine ? 1 : 0) - (filters.hideCancelled ? 1 : 0) - (filters.q.trim() ? 1 : 0) - filters.quick.length;
  const set = <K extends keyof ScheduleFilters>(key: K, value: ScheduleFilters[K]) => onChange({ ...filters, [key]: value });

  return (
    <section aria-label="Schedule filters" className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 basis-full sm:w-auto sm:min-w-[12rem] sm:max-w-xs sm:flex-1 sm:basis-auto">
          <label htmlFor={searchId} className="sr-only">Find client by name or MRN</label>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            id={searchId}
            type="search"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onChange({ ...filters, q: qDraft });
                onJumpToMatch?.(qDraft);
              }
            }}
            placeholder="Find client (name or MRN)"
            className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>
        {onJumpToMatch && filters.q.trim() ? (
          <button type="button" onClick={() => onJumpToMatch(filters.q)} className={`min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 md:min-h-0 hover:bg-blue-50 ${focusRing}`}>
            Go to next visit
          </button>
        ) : null}
        {canUseMine ? (
          <button
            type="button"
            aria-pressed={filters.mine}
            onClick={() => set('mine', !filters.mine)}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold md:min-h-0 ${pressedCls(filters.mine)} ${focusRing}`}
          >
            <User aria-hidden className="h-3.5 w-3.5" /> My schedule
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={filters.hideCancelled}
          onClick={() => set('hideCancelled', !filters.hideCancelled)}
          className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold md:min-h-0 ${pressedCls(filters.hideCancelled)} ${focusRing}`}
        >
          <EyeOff aria-hidden className="h-3.5 w-3.5" /> Hide cancelled / no-shows
        </button>
        <button
          ref={filtersBtn}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold md:min-h-0 ${pressedCls(open || panelCount > 0)} ${focusRing}`}
        >
          <Filter aria-hidden className="h-3.5 w-3.5" /> Filters
          {panelCount > 0 ? (
            <span className="rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white">
              {panelCount}
            </span>
          ) : null}
        </button>
        {savedViews.length ? (
          <>
            <label htmlFor={`${panelId}-views`} className="sr-only">Saved views</label>
            <select
              id={`${panelId}-views`}
              value=""
              onChange={(e) => {
                const v = savedViews.find((x) => x.name === e.target.value);
                if (v) onApplyView(v);
              }}
              className="min-h-10 max-w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 md:min-h-0 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            >
              <option value="">Saved views</option>
              {savedViews.map((v) => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
          </>
        ) : null}
        <p aria-live="polite" aria-atomic="true" className="ml-auto min-w-0 text-xs text-slate-600">
          Showing <strong className="text-slate-900">{shown}</strong> of <strong className="text-slate-900">{total}</strong> appointments {rangeText}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
        {QUICK_FILTERS.map((q) => {
          const on = filters.quick.includes(q);
          return (
            <button
              key={q}
              type="button"
              aria-pressed={on}
              onClick={() => set('quick', toggleValue(filters.quick, q))}
              className={`min-h-9 rounded-full border px-2.5 py-1 text-xs font-semibold md:min-h-0 ${pressedCls(on)} ${focusRing}`}
            >
              {QUICK_FILTER_LABEL[q]}
            </button>
          );
        })}
      </div>

      {chips.length || !isDefault ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Active</span>
          {chips.map((c) => (
            <span key={`${c.key}:${c.value}`} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-blue-700">
              {c.label}
              <IconButton
                label={`Remove filter ${c.label}`}
                icon={<X className="h-3 w-3" />}
                onClick={() => onChange(removeChip(filters, c))}
                className="h-8 w-8 rounded-full hover:bg-blue-100 md:h-5 md:w-5"
              />
            </span>
          ))}
          {chips.length ? (
            <button type="button" onClick={() => onChange(emptyFilters())} className={`rounded px-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline ${focusRing}`}>
              Clear all
            </button>
          ) : null}
          {!isDefault ? (
            <button type="button" onClick={onReset} className={`inline-flex items-center gap-1 rounded px-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline ${focusRing}`}>
              <RotateCcw aria-hidden className="h-3 w-3" /> Reset to default
            </button>
          ) : null}
        </div>
      ) : null}

      {note ? <p className="mt-2 text-xs text-slate-500">{note}</p> : null}

      {open ? (
        <>
          {/* Phones: the panel is a bottom sheet over a backdrop; desktop: inline under the bar */}
          <div aria-hidden className="fixed inset-0 z-40 bg-slate-950/50 md:hidden" onClick={() => setOpen(false)} />
          <div
            id={panelId}
            ref={panelRef}
            role="region"
            aria-label="All schedule filters"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl md:static md:pb-4 md:z-auto md:mt-3 md:max-h-none md:rounded-xl md:border md:border-slate-200 md:bg-slate-50 md:shadow-none"
          >
            <div className="mb-3 flex items-center justify-between md:hidden">
              <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
              <IconButton label="Close filters" icon={<X className="h-4 w-4" />} onClick={() => { setOpen(false); filtersBtn.current?.focus(); }} className="h-10 w-10 hover:bg-slate-100" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <CheckGroup legend="Provider" options={options.providers} selected={filters.providers} onChange={(v) => set('providers', v)} searchable />
              <CheckGroup legend="Location" options={options.locations} selected={filters.locations} onChange={(v) => set('locations', v)} emptyText="No client sites on file" />
              <CheckGroup legend="Appointment type" options={options.types} selected={filters.types} onChange={(v) => set('types', v)} searchable={options.types.length > 8} />
              <CheckGroup
                legend="Status"
                options={FILTER_STATUSES.map((s) => ({ value: s, label: FILTER_STATUS_LABEL[s] }))}
                selected={filters.statuses}
                onChange={(v) => set('statuses', v as ScheduleFilters['statuses'])}
              />
              <CheckGroup
                legend="Visit mode"
                options={VISIT_MODES.map((m) => ({ value: m, label: VISIT_MODE_LABEL[m] }))}
                selected={filters.modes}
                onChange={(v) => set('modes', v as ScheduleFilters['modes'])}
              />
              <CheckGroup
                legend="Program"
                options={PROGRAMS.map((p) => ({ value: p, label: PROGRAM_LABEL[p] }))}
                selected={filters.programs}
                onChange={(v) => set('programs', v as ScheduleFilters['programs'])}
              />
              <CheckGroup legend="Calendar label" options={options.labels} selected={filters.labels} onChange={(v) => set('labels', v)} emptyText="No labels set up" />
              <CheckGroup legend="Payer" options={options.payers} selected={filters.payers} onChange={(v) => set('payers', v)} searchable={options.payers.length > 8} />
            </div>

            <div className="mt-5 border-t border-slate-200 pt-4">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                <Bookmark aria-hidden className="h-3.5 w-3.5" /> Saved views
              </h3>
              <p className="mt-1 text-xs text-slate-500">Saved in this browser for your account.</p>
              <form
                className="mt-2 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!viewName.trim()) return;
                  onSaveView(viewName);
                  setViewName('');
                }}
              >
                <label htmlFor={viewNameId} className="sr-only">View name</label>
                <input
                  id={viewNameId}
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  maxLength={60}
                  placeholder="Name this view (e.g. PRP today)"
                  className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 sm:max-w-xs"
                />
                <button type="submit" disabled={!viewName.trim()} className={buttonClasses({ size: 'sm' })}>
                  Save current filters
                </button>
              </form>
              {savedViews.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {savedViews.map((v) => (
                    <li key={v.name} className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white pl-2.5 pr-1 text-xs">
                      <button type="button" onClick={() => onApplyView(v)} className={`rounded font-semibold text-slate-800 hover:text-blue-700 ${focusRing}`}>
                        {v.name}
                      </button>
                      <IconButton label={`Delete saved view ${v.name}`} icon={<Trash2 className="h-3 w-3" />} onClick={() => onDeleteView(v.name)} className="h-6 w-6 rounded-full text-slate-500 hover:bg-slate-100 hover:text-rose-700" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end md:hidden">
              <button type="button" onClick={() => { setOpen(false); filtersBtn.current?.focus(); }} className={buttonClasses()}>
                Show {shown} appointments
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
