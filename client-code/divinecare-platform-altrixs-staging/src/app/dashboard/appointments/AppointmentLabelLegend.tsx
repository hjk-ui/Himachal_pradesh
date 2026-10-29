'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Filter, Tag, X } from 'lucide-react';
import type { AppointmentLabelDto } from '@/lib/scheduling/appointmentLabels';
import { Alert, Card, cx, FOCUS_RING } from '@/components/ui';

/** Filter key for appointments without a label */
export const NO_LABEL = '__none__';

const OPEN_KEY = 'altrixs.calendar.labelLegendOpen';

/**
 * Collapsible legend: each label with its count in the visible range; clicking toggles a filter.
 * Counts include turned-off labels still on appointments so nothing on screen is unexplained.
 */
export function AppointmentLabelLegend({
  labels,
  ready,
  appointments,
  rangeText,
  selected,
  onChange,
}: {
  labels: AppointmentLabelDto[];
  ready: boolean;
  appointments: Array<{ labelId?: string | null; label?: { id: string; displayName: string; color: string; textColor: string } | null }>;
  rangeText: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      /* private mode */
    }
  }, []);
  const toggleOpen = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  const { counts, extra, none } = useMemo(() => {
    const c = new Map<string, number>();
    const ex = new Map<string, { id: string; displayName: string; color: string; textColor: string }>();
    let n = 0;
    for (const a of appointments) {
      if (!a.labelId || !a.label) {
        n += 1;
        continue;
      }
      c.set(a.labelId, (c.get(a.labelId) ?? 0) + 1);
      if (!labels.some((l) => l.id === a.labelId)) ex.set(a.labelId, a.label);
    }
    return { counts: c, extra: [...ex.values()], none: n };
  }, [appointments, labels]);

  const items = [
    ...labels.map((l) => ({ id: l.id, displayName: l.displayName, color: l.color, textColor: l.textColor })),
    ...extra,
  ];

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (!ready) {
    return (
      <Alert tone="warning">
        Calendar labels are not available on this server yet (database migration pending).
      </Alert>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          className={cx('inline-flex items-center gap-1.5 rounded text-xs font-semibold text-slate-700 hover:text-blue-700', FOCUS_RING)}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          <Tag className="h-3.5 w-3.5" aria-hidden /> Calendar labels
          <span className="font-normal text-slate-500">· counts for {rangeText}</span>
        </button>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className={cx('inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-100', FOCUS_RING)}
          >
            <Filter className="h-3 w-3" aria-hidden /> Filtered by {selected.length} label{selected.length === 1 ? '' : 's'}
            <X className="h-3 w-3" aria-hidden />
            <span className="sr-only">Clear label filter</span>
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="border-t border-slate-200 px-4 py-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by calendar label">
            {items.map((l) => {
              const on = selected.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(l.id)}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold',
                    on ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                    FOCUS_RING,
                  )}
                >
                  <span
                    className="inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums"
                    // Data-driven: practice-configured label colours
                    style={{ backgroundColor: l.color, color: l.textColor }}
                  >
                    {counts.get(l.id) ?? 0}
                  </span>
                  {l.displayName}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={selected.includes(NO_LABEL)}
              onClick={() => toggle(NO_LABEL)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold',
                selected.includes(NO_LABEL)
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                FOCUS_RING,
              )}
            >
              <span className="inline-flex min-w-[1.5rem] justify-center rounded-full border border-slate-300 bg-white px-1.5 text-[11px] font-semibold tabular-nums text-slate-700">
                {none}
              </span>
              No label
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Click labels to show only those appointments. Labels are set up in{' '}
            <Link href="/dashboard/admin/scheduling-settings#calendar-labels" className="font-semibold text-blue-700 hover:underline">
              Scheduling settings
            </Link>
            .
          </p>
        </div>
      ) : null}
    </Card>
  );
}
