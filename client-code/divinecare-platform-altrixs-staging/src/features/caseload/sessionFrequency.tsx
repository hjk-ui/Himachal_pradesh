'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, CalendarPlus, ExternalLink, Info, Loader2 } from 'lucide-react';
import type {
  AlertBucket,
  CadenceStatus,
  ClinicianCadenceRow,
  ServiceCadence,
  SessionFrequencyItem,
  SessionFrequencySummary,
} from '@/lib/clinical/sessionFrequency';
import { buttonClasses, cardClasses, cx, StatusBadge, TONE_SOFT, type Tone } from '@/components/ui';

export type { AlertBucket, ClinicianCadenceRow, SessionFrequencyItem, SessionFrequencySummary };

const EMPTY_SUMMARY: SessionFrequencySummary = {
  total: 0,
  overdue: 0,
  due_soon: 0,
  scheduled: 0,
  on_track: 0,
  no_sessions: 0,
  not_tracked: 0,
  unassigned: 0,
  likely_inactive: 0,
};

/**
 * GET /api/clinical/session-frequency — one source for the banner, the alert list and the chart card.
 * Optional: `view: 'summary'` (counts for the whole scope, items only for `buckets`), `clientIds`
 * (only those clients, e.g. the visible directory page).
 */
export function useSessionFrequency(
  opts: {
    clientId?: string;
    locationId?: string;
    enabled?: boolean;
    view?: 'summary';
    buckets?: AlertBucket[];
    clientIds?: string[];
  } = {}
) {
  const { clientId, locationId, enabled = true, view } = opts;
  const bucketsKey = opts.buckets ? opts.buckets.join(',') : null;
  const clientIdsKey = opts.clientIds ? opts.clientIds.join(',') : null;
  const [items, setItems] = useState<SessionFrequencyItem[]>([]);
  const [summary, setSummary] = useState<SessionFrequencySummary>(EMPTY_SUMMARY);
  const [byClinician, setByClinician] = useState<ClinicianCadenceRow[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (clientIdsKey === '') {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (clientId) qs.set('clientId', clientId);
      if (locationId) qs.set('locationId', locationId);
      if (view) qs.set('view', view);
      if (bucketsKey != null) qs.set('buckets', bucketsKey);
      if (clientIdsKey) qs.set('clientIds', clientIdsKey);
      const res = await fetch(`/api/clinical/session-frequency${qs.size ? `?${qs}` : ''}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || `Could not load session frequency (${res.status})`);
        setItems([]);
        setSummary(EMPTY_SUMMARY);
        return;
      }
      setItems(data.items);
      setSummary(data.summary ?? EMPTY_SUMMARY);
      setByClinician(Array.isArray(data.byClinician) ? data.byClinician : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load session frequency');
    } finally {
      setLoading(false);
    }
  }, [clientId, locationId, enabled, view, bucketsKey, clientIdsKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, summary, byClinician, loading, error, reload };
}

/** `tone` is the soft pill class set, `dot` a Tailwind bg class, `badge` the StatusBadge tone. */
export const BUCKET_META: Record<AlertBucket, { label: string; tone: string; dot: string; badge: Tone }> = {
  overdue: { label: 'Overdue', tone: TONE_SOFT.danger, dot: 'bg-rose-500', badge: 'danger' },
  due_soon: { label: 'Due soon', tone: TONE_SOFT.warning, dot: 'bg-amber-500', badge: 'warning' },
  scheduled: { label: 'Scheduled', tone: TONE_SOFT.info, dot: 'bg-sky-500', badge: 'info' },
  on_track: { label: 'On track', tone: TONE_SOFT.success, dot: 'bg-emerald-500', badge: 'success' },
  no_sessions: { label: 'No sessions yet', tone: TONE_SOFT.neutral, dot: 'bg-slate-500', badge: 'neutral' },
  not_tracked: { label: 'Not tracked', tone: TONE_SOFT.neutral, dot: 'bg-slate-400', badge: 'neutral' },
  unassigned: { label: 'Unassigned', tone: TONE_SOFT.brand, dot: 'bg-blue-600', badge: 'brand' },
  likely_inactive: { label: 'Overdue more than 180 days — likely inactive', tone: TONE_SOFT.neutral, dot: 'bg-slate-400', badge: 'neutral' },
};

function statusMeta(status: CadenceStatus) {
  return BUCKET_META[status];
}

function fmt(day: string | null) {
  if (!day) return '—';
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function scheduleHref(clientId: string) {
  return `/dashboard/appointments?client=${encodeURIComponent(clientId)}&new=1`;
}

/** Compact chip for the client directory card / table (recommended frequency + status) */
export function CadenceChip({
  item,
  loading,
  showDetail = false,
  inline = false,
}: {
  item: SessionFrequencyItem | undefined;
  loading?: boolean;
  showDetail?: boolean;
  /** One line for table rows: a dot + short status; the frequency and full status are in the tooltip */
  inline?: boolean;
}) {
  if (inline) {
    if (loading) return <span className="text-[11px] text-slate-400">…</span>;
    if (!item) return null;
    const meta = BUCKET_META[item.bucket];
    const short = item.bucket === 'likely_inactive' ? 'Likely inactive' : meta.label;
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-slate-600"
        title={`Therapy: ${item.therapy.recommendation.label} · ${meta.label}`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
        {short}
        <span className="sr-only">, recommended therapy {item.therapy.recommendation.label}</span>
      </span>
    );
  }
  if (loading) {
    return <span className="text-[11px] text-slate-500">Loading cadence…</span>;
  }
  if (!item) {
    return <span className="text-[11px] text-slate-500">Not tracked (inactive or out of scope)</span>;
  }
  const t = item.therapy;
  const meta = BUCKET_META[item.bucket];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-800">
        <CalendarDays size={13} className="shrink-0 text-blue-600" aria-hidden />
        <span>Therapy: {t.recommendation.label}</span>
        <StatusBadge tone={meta.badge} size="sm">{meta.label}</StatusBadge>
      </div>
      {showDetail && (
        <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-slate-600">
          <p>{t.recommendation.sourceDetail}</p>
          {!item.locked && (
            <p>
              Last attended {fmt(t.lastAttended)} · Next {fmt(t.nextScheduled)} · {t.sessionsLast8Weeks} in 8 wks
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CadenceBlock({ title, c }: { title: string; c: ServiceCadence }) {
  const meta = statusMeta(c.status);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-600">{title}</p>
        <StatusBadge tone={meta.badge} size="sm">{meta.label}</StatusBadge>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-slate-900">{c.recommendation.label}</p>
      <p className="text-xs text-slate-600">{c.recommendation.sourceDetail}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Last attended</dt>
          <dd className="font-semibold text-slate-800">{fmt(c.lastAttended)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Next scheduled</dt>
          <dd className="font-semibold text-slate-800">{fmt(c.nextScheduled)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Last 8 weeks</dt>
          <dd className="font-semibold text-slate-800">
            {c.sessionsLast8Weeks} sessions ({c.sessionsPerWeek}/wk)
            {c.expectedLast8Weeks != null ? ` · expected ~${c.expectedLast8Weeks}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Overdue after</dt>
          <dd className="font-semibold text-slate-800">{fmt(c.overdueAfter)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-slate-500">{c.statusDetail}</p>
    </div>
  );
}

/** Chart card: recommended frequency with its source, actual cadence and status */
export function SessionFrequencyCard({ clientId, canSchedule = true }: { clientId: string; canSchedule?: boolean }) {
  const { items, loading, error } = useSessionFrequency({ clientId });
  const item = items[0];
  return (
    <section className={cx(cardClasses, 'p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CalendarDays size={16} className="text-blue-600" aria-hidden />
          Session frequency
        </h3>
        {item && canSchedule && !item.locked ? (
          <Link
            href={scheduleHref(clientId)}
            className={buttonClasses({ size: 'sm' })}
          >
            <CalendarPlus size={13} aria-hidden /> Schedule
          </Link>
        ) : null}
      </div>
      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" aria-hidden /> Loading…
        </p>
      ) : error ? (
        <p className="mt-3 text-xs text-rose-700">{error}</p>
      ) : !item ? (
        <p className="mt-3 text-xs text-slate-500">
          Not tracked: the client is discharged or inactive, or is not on your caseload.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {!item.assignedToId && (
            <p className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              <AlertTriangle size={13} aria-hidden /> No assigned clinician — listed under Unassigned on the alerts page.
            </p>
          )}
          <CadenceBlock title="Individual therapy (90832 / 90834 / 90837)" c={item.therapy} />
          <CadenceBlock title="Medication management (99212–99215)" c={item.medManagement} />
          {item.dataNotes.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="mb-1 flex items-center gap-1 font-semibold text-slate-700">
                <Info size={12} aria-hidden /> Not counted
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {item.dataNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Attended = appointment checked in / in session / completed, a claim on the visit, a signed note with a CPT,
            or a billed Valant charge. Cancelled, late-cancel and no-show visits never count.
          </p>
        </div>
      )}
    </section>
  );
}

/** Alert list rows (alerts page). Rendered from the same items the counts are computed from. */
export function SessionFrequencyTable({ items }: { items: SessionFrequencyItem[] }) {
  if (!items.length) {
    return <p className="px-4 py-6 text-center text-sm text-slate-500">No clients in this group.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
            <th scope="col" className="px-4 py-2.5">Client</th>
            <th scope="col" className="px-4 py-2.5">Recommended</th>
            <th scope="col" className="px-4 py-2.5">Last attended</th>
            <th scope="col" className="px-4 py-2.5">Days overdue</th>
            <th scope="col" className="px-4 py-2.5">Next scheduled</th>
            <th scope="col" className="px-4 py-2.5">Clinician</th>
            <th scope="col" className="px-4 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => {
            const t = item.therapy;
            return (
              <tr key={item.clientId} className="align-top hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="max-w-[14rem] break-words font-semibold text-slate-900">{item.clientName}</p>
                  {item.locationName && <p className="text-xs text-slate-500">{item.locationName}</p>}
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-800">{t.recommendation.label}</p>
                  <p className="max-w-[16rem] text-xs text-slate-500">{t.recommendation.sourceDetail}</p>
                </td>
                <td className="px-4 py-3 text-xs text-slate-700">
                  {fmt(t.lastAttended)}
                  {t.daysSinceLast != null && <span className="block text-xs text-slate-500">{t.daysSinceLast} days ago</span>}
                </td>
                <td className="px-4 py-3 text-xs font-semibold text-rose-700">{t.daysOverdue > 0 ? t.daysOverdue : '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-700">{fmt(t.nextScheduled)}</td>
                <td className="px-4 py-3 text-xs text-slate-700">{item.assignedToName || <span className="font-semibold text-blue-700">Unassigned</span>}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                    {!item.locked && (
                      <Link href={scheduleHref(item.clientId)} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                        <CalendarPlus size={12} aria-hidden /> Schedule
                      </Link>
                    )}
                    <Link href={`/dashboard/clients/${item.clientId}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                      Chart <ExternalLink size={12} aria-hidden />
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Action bar for the "Overdue more than 180 days — likely inactive" group: one click opens a
 * discharge case in planning for each client (POST /api/clinical/session-frequency/discharge-review),
 * then the review continues on Discharge & Transition Planning. Nothing is discharged here.
 */
export function LikelyInactiveActions({ items, canReview, onDone }: { items: SessionFrequencyItem[]; canReview: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/clinical/session-frequency/discharge-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds: items.map((i) => i.clientId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not start the discharge reviews');
      setMessage(
        `${data.started} discharge review${data.started === 1 ? '' : 's'} opened in planning` +
          (data.alreadyOpen ? ` · ${data.alreadyOpen} already had one` : '') +
          (data.skippedProtected ? ` · ${data.skippedProtected} protected record(s) skipped` : '')
      );
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the discharge reviews');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
      <Info size={13} className="shrink-0 text-slate-500" aria-hidden />
      <span className="min-w-0 flex-1">
        No appointment or note in the last 180 days and nothing booked. These are not counted as overdue; review them for
        discharge. Nothing is discharged automatically.
      </span>
      {canReview && items.length > 0 && (
        <button type="button" onClick={() => void run()} disabled={busy} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
          Mark inactive / discharge review ({items.length})
        </button>
      )}
      <Link href="/dashboard/ehr/discharge" className="font-semibold text-blue-700 hover:underline">
        Open discharge planning
      </Link>
      {message && <span className="w-full text-emerald-700">{message}</span>}
      {error && <span role="alert" className="w-full text-rose-700">{error}</span>}
    </div>
  );
}
