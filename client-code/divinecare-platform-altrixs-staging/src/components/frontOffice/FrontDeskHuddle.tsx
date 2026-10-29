'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, ClipboardCheck, ExternalLink, Moon, RefreshCw, Search, Sunrise, Video } from 'lucide-react';
import { useLocation } from '@/context/LocationContext';
import { FO_LABELS, isOpen } from '@/lib/frontOffice/rules';
import type { FoApptStatus, FoDaySummary, FoItem, FoItemId, FoPhase, FoRow } from '@/lib/frontOffice/types';
import { FrontOfficeItemList, PHASE_LABELS } from './FrontOfficeItemList';
import { appointmentHref, useFrontOffice } from './useFrontOffice';
import { cx, FOCUS_RING, IconButton, LoadingState, EmptyState, StatusBadge, Tabs, type Tone } from '@/components/ui';

type Tab = 'today' | 'tomorrow' | 'eod';

const STATUS_LABEL: Record<FoApptStatus, string> = {
  SCHEDULED: 'Scheduled',
  CHECKED_IN: 'Checked in',
  IN_SESSION: 'In session',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
  LATE_CANCEL: 'Late cancel',
};
const STATUS_TONE: Record<FoApptStatus, Tone> = {
  SCHEDULED: 'neutral',
  CHECKED_IN: 'info',
  IN_SESSION: 'brand',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
  LATE_CANCEL: 'warning',
};
const KEPT: FoApptStatus[] = ['CHECKED_IN', 'IN_SESSION', 'COMPLETED'];
const MISSED: FoApptStatus[] = ['NO_SHOW', 'LATE_CANCEL'];

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Phases shown for a row on a tab (the work that applies to it right now). */
export function phasesFor(tab: Tab, status: FoApptStatus): FoPhase[] {
  if (tab === 'tomorrow') return status === 'CANCELLED' ? [] : ['prep'];
  if (MISSED.includes(status)) return ['end_of_day'];
  if (status === 'CANCELLED') return [];
  if (KEPT.includes(status)) return tab === 'eod' ? ['check_out'] : ['check_in', 'check_out'];
  return tab === 'eod' ? ['check_in'] : ['prep', 'check_in'];
}

function visibleItems(tab: Tab, row: FoRow): FoItem[] {
  const phases = phasesFor(tab, row.status);
  return row.items.filter((x) => phases.includes(x.phase) || (tab === 'eod' && x.id === 'copay' && KEPT.includes(row.status)));
}

function openCount(items: FoItem[]) {
  return items.filter((x) => isOpen(x) && x.level === 'required').length;
}

function ReadinessBadge({ row, items }: { row: FoRow; items: FoItem[] }) {
  const open = openCount(items);
  const stop = items.some((x) => x.stop && x.status === 'needs_action');
  if (row.status === 'CANCELLED') return <StatusBadge tone="neutral" size="sm">Cancelled</StatusBadge>;
  if (stop) return <StatusBadge tone="danger" size="sm">Resolve first</StatusBadge>;
  if (open) return <StatusBadge tone="warning" size="sm">{open} to do</StatusBadge>;
  return <StatusBadge tone="success" size="sm">Ready</StatusBadge>;
}

function SummaryTile({ label, value, sub, tone = 'slate' }: { label: string; value: string; sub?: string; tone?: 'slate' | 'amber' | 'rose' | 'emerald' }) {
  const tones = { slate: 'text-slate-900', amber: 'text-amber-700', rose: 'text-rose-700', emerald: 'text-emerald-700' };
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
      <p className={`text-xl font-semibold tabular-nums tracking-tight ${tones[tone]}`}>{value}</p>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function EndOfDaySummary({ today, tomorrow }: { today: FoDaySummary | undefined; tomorrow: FoDaySummary | undefined }) {
  if (!today) return null;
  const r = today.reconciliation;
  return (
    <div className="space-y-3 border-b border-slate-100 px-4 py-4 sm:px-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <SummaryTile label="Seen" value={String(today.kept)} sub={`of ${today.total} booked`} />
        <SummaryTile label="No-shows / late cancels" value={String(today.noShows + today.lateCancels)} sub={`${today.byItem.reschedule ?? 0} not rebooked`} tone={today.noShows + today.lateCancels ? 'amber' : 'slate'} />
        <SummaryTile label="Not closed" value={String(today.notClosed)} sub="still scheduled / checked in after the end time" tone={today.notClosed ? 'rose' : 'slate'} />
        <SummaryTile label="Notes not signed" value={String(today.unsignedNotes)} sub="seen today (clinician task)" tone={today.unsignedNotes ? 'amber' : 'slate'} />
        {r ? (
          <>
            <SummaryTile label="Copays posted" value={money(r.collectedCents)} sub={`${r.collectedCount} of ${r.expectedCount} expected visits covered`} tone="emerald" />
            <SummaryTile
              label="Copays not posted"
              value={money(r.missingCents)}
              sub={`${r.missingCount} visit${r.missingCount === 1 ? '' : 's'}${r.markedNotPostedCount ? ` · ${r.markedNotPostedCount} marked collected, not posted` : ''}`}
              tone={r.missingCount ? 'rose' : 'slate'}
            />
          </>
        ) : null}
      </div>
      {r ? <p className="text-xs text-slate-500">Expected = copay rules (or the chart copay) on kept visits, {money(r.expectedCents)} in total. Posted = patient payments recorded today for those clients (no insurance or test payments).</p> : null}
      {tomorrow ? (
        <p className="text-xs text-slate-600">
          <span className="font-semibold text-slate-800">Tomorrow:</span> {tomorrow.total} visits · {tomorrow.ready} ready · {tomorrow.attention + tomorrow.stop} need prep
          {tomorrow.stop ? ` (${tomorrow.stop} to resolve first)` : ''}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Front desk huddle (front desk home): today / tomorrow / end of day for the sidebar location, every
 * appointment with its readiness checks. Rows expand in place (Enter / Space), Arrow keys move between
 * rows, "Open" goes to the appointment on the schedule with the detail open.
 */
export function FrontDeskHuddle({ title = 'Front desk huddle' }: { title?: string }) {
  const { activeLocationId, isAllLocations } = useLocation();
  const { day, loading, error, reload } = useFrontOffice({ days: 2, location: isAllLocations ? null : activeLocationId });
  const [tab, setTab] = useState<Tab>('today');
  // After 4 PM (browser clock) open on End of day; set after mount so server and client render the same
  useEffect(() => {
    if (new Date().getHours() >= 16) setTab('eod');
  }, []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<FoItemId | null>(null);
  const [query, setQuery] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const todayYmd = day?.today ?? null;
  const tomorrowYmd = day?.dates[1] ?? null;
  const date = tab === 'tomorrow' ? tomorrowYmd : todayYmd;
  const summary = day?.summaries.find((s) => s.date === date);

  const rows = useMemo(() => {
    if (!day || !date) return [];
    const q = query.trim().toLowerCase();
    return day.rows
      .filter((r) => r.date === date)
      .filter((r) => showCancelled || r.status !== 'CANCELLED')
      .filter((r) => !q || r.clientName.toLowerCase().includes(q) || (r.clinicianName ?? '').toLowerCase().includes(q))
      .filter((r) => {
        const items = visibleItems(tab, r);
        if (filter) return items.some((x) => x.id === filter && isOpen(x));
        if (tab === 'eod') return items.some(isOpen);
        return true;
      });
  }, [day, date, tab, filter, query, showCancelled]);

  const chips = useMemo(() => {
    if (!day || !date) return [];
    const counts = new Map<FoItemId, number>();
    for (const r of day.rows.filter((x) => x.date === date)) for (const x of visibleItems(tab, r)) if (isOpen(x)) counts.set(x.id, (counts.get(x.id) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [day, date, tab]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-fo-row]') ?? [])];
    const i = buttons.findIndex((b) => b.dataset.foRow === id);
    buttons[Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'today', label: 'Today', icon: <ClipboardCheck /> },
    { key: 'tomorrow', label: 'Prep tomorrow', icon: <Sunrise /> },
    { key: 'eod', label: 'End of day', icon: <Moon /> },
  ];

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs" aria-labelledby="fo-huddle-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1 basis-72">
          <h2 id="fo-huddle-title" className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <CalendarClock size={17} className="text-blue-600" aria-hidden /> {title}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {isAllLocations ? 'All locations' : 'Sidebar location'} · checks from the record; mark what the record cannot show
            {day ? ` · eligibility current within ${day.rules.eligibilityWindowDays} days${day.rules.medicaidSameMonth ? ' (Medicaid: same month)' : ''}` : ''}
          </p>
        </div>
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <Tabs
            variant="pill"
            label="Huddle view"
            controlsPanels={false}
            value={tab}
            onChange={(key) => {
              setTab(key);
              setFilter(null);
              setExpanded(null);
            }}
            items={tabs}
          />
          <IconButton
            label="Refresh"
            icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
            onClick={reload}
            className="h-9 w-9 shrink-0 border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          />
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-900">
          <span>{error}</span>
          <button type="button" onClick={reload} className={cx('rounded text-xs font-semibold text-rose-800 underline', FOCUS_RING)}>
            Try again
          </button>
        </div>
      ) : null}

      {tab === 'eod' ? <EndOfDaySummary today={day?.summaries.find((s) => s.date === todayYmd)} tomorrow={day?.summaries.find((s) => s.date === tomorrowYmd)} /> : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
        {summary && tab !== 'eod' ? (
          <span className="mr-1 text-xs text-slate-600">
            <span className="font-semibold tabular-nums text-slate-900">{summary.total}</span> visits · <span className="font-semibold text-emerald-700">{summary.ready} ready</span> ·{' '}
            <span className="font-semibold text-amber-700">{summary.attention} to do</span>
            {summary.stop ? <span className="font-semibold text-rose-700"> · {summary.stop} resolve first</span> : null}
          </span>
        ) : null}
        <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)} className={cx('min-h-8 rounded-full px-2.5 text-xs font-semibold ring-1', filter === null ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-700 ring-slate-300 hover:ring-blue-600', FOCUS_RING)}>
          {tab === 'eod' ? 'All open' : 'All'}
        </button>
        {chips.map(([id, n]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(filter === id ? null : id)}
            className={cx('min-h-8 rounded-full px-2.5 text-xs font-semibold ring-1', filter === id ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-700 ring-slate-300 hover:ring-blue-600', FOCUS_RING)}
          >
            {FO_LABELS[id]} <span className="ml-0.5 tabular-nums opacity-80">{n}</span>
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex min-h-8 items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-blue-600" /> Cancelled
          </label>
          <div className="relative">
            <Search size={13} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Client or clinician"
              aria-label="Search the huddle"
              className="min-h-8 w-40 rounded-lg border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 sm:w-48"
            />
          </div>
        </div>
      </div>

      <div ref={listRef} className="divide-y divide-slate-100">
        {loading && !day ? (
          <LoadingState label="Loading the huddle…" />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={<ClipboardCheck />}
            title={tab === 'eod' ? 'Nothing left to close out today.' : filter ? 'No visits need this.' : 'No visits on this day.'}
            description={filter ? 'Clear the filter to see every visit.' : 'Visits booked on the schedule appear here with their front desk checks.'}
          />
        ) : (
          rows.map((row) => {
            const items = visibleItems(tab, row);
            const open = expanded === row.appointmentId;
            const flags = items.filter((x) => isOpen(x)).slice(0, 4);
            return (
              <div key={row.appointmentId} className={open ? 'bg-slate-50' : ''}>
                <div className="flex items-center gap-2 px-3 py-2.5 sm:px-5">
                  <button
                    type="button"
                    data-fo-row={row.appointmentId}
                    aria-expanded={open}
                    aria-controls={`fo-items-${row.appointmentId}`}
                    onClick={() => setExpanded(open ? null : row.appointmentId)}
                    onKeyDown={(e) => onKey(e, row.appointmentId)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:gap-3"
                  >
                    {open ? <ChevronDown size={16} aria-hidden className="shrink-0 text-slate-400" /> : <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-400" />}
                    <span className="w-16 shrink-0 text-xs font-semibold tabular-nums text-slate-700">{clock(row.startTime)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-slate-900">{row.clientName}</span>
                        {row.isNewClient ? <StatusBadge tone="brand" size="sm">New</StatusBadge> : null}
                        {row.isVirtual ? <Video size={13} className="text-sky-700" aria-label="Video visit" /> : null}
                        <StatusBadge tone={STATUS_TONE[row.status]} size="sm">{STATUS_LABEL[row.status]}</StatusBadge>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        {row.clinicianName || 'Unassigned'} · {row.type}
                        {row.locationName && isAllLocations ? ` · ${row.locationName}` : ''}
                        {row.payer ? ` · ${row.payer}` : ' · Self-pay'}
                      </span>
                      {!open && flags.length ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {flags.map((x) => (
                            <StatusBadge key={x.id} tone={x.stop ? 'danger' : 'warning'} size="sm">
                              {x.label}
                            </StatusBadge>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0">
                      <ReadinessBadge row={row} items={items} />
                    </span>
                  </button>
                  <Link
                    href={appointmentHref(row)}
                    className={cx('inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50', FOCUS_RING)}
                    aria-label={`Open the appointment for ${row.clientName}`}
                  >
                    Open <ExternalLink size={12} aria-hidden />
                  </Link>
                </div>
                {open ? (
                  <div id={`fo-items-${row.appointmentId}`} className="px-4 pb-3 md:pl-14 md:pr-5">
                    {phasesFor(tab, row.status).map((phase) => {
                      const list = items.filter((x) => x.phase === phase || (tab === 'eod' && phase === 'check_out' && x.id === 'copay'));
                      if (!list.length) return null;
                      return (
                        <div key={phase} className="mt-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{PHASE_LABELS[phase]}</p>
                          <FrontOfficeItemList row={row} items={list} onChanged={reload} />
                        </div>
                      );
                    })}
                    {row.locked ? <p className="mt-2 text-xs text-slate-500">Protected record: open the appointment to work on this visit.</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      {day?.hidden.length ? <p className="border-t border-slate-200 px-5 py-2 text-xs text-slate-500">Not shown for your role: {day.hidden.join(', ')}</p> : null}
    </section>
  );
}
