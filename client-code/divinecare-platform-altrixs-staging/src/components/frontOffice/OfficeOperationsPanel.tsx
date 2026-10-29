'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, Building2, FileClock, ListOrdered, RefreshCw, UserPlus } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useLocation } from '@/context/LocationContext';
import type { FrontOfficeOperations } from '@/lib/frontOffice/operations';
import { cx, EmptyState, FOCUS_RING, IconButton, LoadingState, StatusBadge } from '@/components/ui';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const apptLink = (id: string, date: string, focus?: string) =>
  `/dashboard/appointments?view=calendar&cal=day&d=${date}&appt=${encodeURIComponent(id)}${focus ? `&focus=${focus}` : ''}`;

function Cell({ label, value, sub, href, tone = 'slate' }: { label: string; value: string; sub?: string; href?: string; tone?: 'slate' | 'amber' | 'rose' | 'emerald' }) {
  const tones = { slate: 'text-slate-900', amber: 'text-amber-700', rose: 'text-rose-700', emerald: 'text-emerald-700' };
  const body = (
    <>
      <p className={`text-xl font-semibold tabular-nums tracking-tight ${tones[tone]}`}>{value}</p>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </>
  );
  const cls = 'block rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200';
  return href ? (
    <Link href={href} className={cx(cls, 'transition hover:bg-white hover:ring-blue-300', FOCUS_RING)}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * Office manager operations view: readiness by location (today / tomorrow), exceptions queue,
 * waitlist fill opportunities, notes past the signing deadline (counts by clinician), staff invites
 * not accepted, open front-desk work and today's copay reconciliation. Small cells, no clinical content.
 */
export function OfficeOperationsPanel() {
  const { activeLocationId, isAllLocations } = useLocation();
  const [ops, setOps] = useState<FrontOfficeOperations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = isAllLocations ? '' : `?location=${encodeURIComponent(activeLocationId)}`;
    apiJson<{ ops: FrontOfficeOperations }>(`/api/appointments/front-office/operations${qs}`)
      .then((r) => {
        if (!cancelled) {
          setOps(r.ops);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load operations');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLocationId, isAllLocations, nonce]);

  const today = ops?.summaries.find((s) => s.date === ops.today);
  const rec = today?.reconciliation ?? null;

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs" aria-labelledby="ops-title">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 id="ops-title" className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Building2 size={17} className="text-blue-600" aria-hidden /> Front office operations
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Readiness across locations and what needs a decision. Counts only; open a row for the visit.</p>
        </div>
        <IconButton
          label="Refresh"
          icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
          onClick={() => setNonce((n) => n + 1)}
          className="h-9 w-9 shrink-0 border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        />
      </div>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-900">
          <span>{error}</span>
          <button type="button" onClick={() => setNonce((n) => n + 1)} className={cx('rounded text-xs font-semibold text-rose-800 underline', FOCUS_RING)}>
            Try again
          </button>
        </div>
      ) : null}
      {loading && !ops ? (
        <LoadingState label="Loading operations…" />
      ) : !ops && !error ? (
        <EmptyState compact icon={<Building2 />} title="No operations data yet." description="Refresh to load readiness for your locations." />
      ) : ops ? (
        <div className="space-y-5 p-4 sm:p-5">
          {/* Readiness by location */}
          <div className="grid gap-4 lg:grid-cols-2">
            {ops.rollup.map((r) => (
              <div key={r.date}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{r.date === ops.today ? 'Today' : 'Tomorrow'} · {r.date}</p>
                {r.locations.length === 0 ? (
                  <p className="text-xs text-slate-500">No visits.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                        <th scope="col" className="px-3 py-2">Location</th>
                        <th scope="col" className="px-3 py-2 text-right">Visits</th>
                        <th scope="col" className="px-3 py-2 text-right">Ready</th>
                        <th scope="col" className="px-3 py-2 text-right">To do</th>
                        <th scope="col" className="px-3 py-2 text-right">Resolve first</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.locations.map((l) => (
                        <tr key={l.locationId ?? 'none'}>
                          <td className="px-3 py-2 font-semibold text-slate-800">{l.locationName}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">{l.visits}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">{l.ready}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-700">{l.attention}</td>
                          <td className={`px-3 py-2 text-right font-semibold tabular-nums ${l.stop ? 'text-rose-700' : 'text-slate-500'}`}>{l.stop}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Small cells */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <Cell label="Open front-desk items" value={String(ops.openFrontDeskTasks.openItems)} sub={`today + tomorrow${ops.openFrontDeskTasks.deferred ? ` · ${ops.openFrontDeskTasks.deferred} deferred (30d)` : ''}`} tone={ops.openFrontDeskTasks.openItems ? 'amber' : 'slate'} />
            <Cell label="Copays not posted today" value={rec ? money(rec.missingCents) : '—'} sub={rec ? `${rec.missingCount} visits · posted ${money(rec.collectedCents)}` : 'Ledger not available for your role'} tone={rec?.missingCount ? 'rose' : 'slate'} href="/dashboard/billing/payments" />
            <Cell label="Open slots to fill" value={String(ops.waitlist.openSlots.length)} sub={`${ops.waitlist.waiting} on the waitlist`} href="/dashboard/clients/waitlist" tone={ops.waitlist.openSlots.some((s) => s.matches > 0) ? 'amber' : 'slate'} />
            <Cell label="Notes past due" value={String(ops.unsignedNotes.total)} sub={`unsigned > ${ops.unsignedNotes.deadlineHours}h, last 30 days`} tone={ops.unsignedNotes.total ? 'rose' : 'slate'} />
            <Cell label="Staff not activated" value={String(ops.staff.invitedNotActive)} sub="invited, not signed in yet" tone={ops.staff.invitedNotActive ? 'amber' : 'slate'} />
            <Cell label="No-shows today" value={String((today?.noShows ?? 0) + (today?.lateCancels ?? 0))} sub={`${today?.byItem.reschedule ?? 0} not rebooked`} />
          </div>

          {/* Exceptions queue */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <AlertTriangle size={12} aria-hidden /> Exceptions ({ops.dates[0]} to {ops.dates[ops.dates.length - 1]})
            </p>
            {ops.exceptions.length === 0 ? (
              <p className="text-xs text-slate-500">No exceptions in the window.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {ops.exceptions.map((g) => {
                  const open = openGroup === g.key;
                  return (
                    <li key={g.key}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenGroup(open ? null : g.key)}
                        className="flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
                      >
                        <span className="font-semibold text-slate-800">{g.label}</span>
                        <StatusBadge tone="warning">{g.count}</StatusBadge>
                      </button>
                      {open ? (
                        <ul className="space-y-1 px-3.5 pb-3">
                          {g.items.map((i) => (
                            <li key={i.appointmentId} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                              <Link href={apptLink(i.appointmentId, i.date, g.key)} className="font-semibold text-blue-700 hover:underline">
                                {i.clientName}
                              </Link>
                              <span className="text-slate-500">
                                {i.date} {clock(i.startTime)}
                                {i.locationName ? ` · ${i.locationName}` : ''}
                              </span>
                              <span className="w-full text-slate-500">{i.reason}</span>
                            </li>
                          ))}
                          {g.count > g.items.length ? <li className="text-xs text-slate-500">and {g.count - g.items.length} more on the huddle</li> : null}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <ListOrdered size={12} aria-hidden /> Cancelled slots to fill (next 7 days)
              </p>
              {ops.waitlist.openSlots.length === 0 ? (
                <p className="text-xs text-slate-500">No open cancelled slots.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {ops.waitlist.openSlots.slice(0, 8).map((s) => (
                    <li key={s.appointmentId} className="flex items-center justify-between gap-2">
                      <Link href={apptLink(s.appointmentId, s.date, 'waitlist')} className="font-semibold text-blue-700 hover:underline">
                        {s.date} {clock(s.startTime)} · {s.clinicianName || 'Unassigned'}
                      </Link>
                      <span className={s.matches ? 'font-semibold text-amber-700' : 'text-slate-500'}>{s.matches ? `${s.matches} waitlist match${s.matches === 1 ? '' : 'es'}` : 'no match'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <FileClock size={12} aria-hidden /> Notes past the {ops.unsignedNotes.deadlineHours}h deadline, by clinician
              </p>
              {ops.unsignedNotes.byClinician.length === 0 ? (
                <p className="text-xs text-slate-500">None.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {ops.unsignedNotes.byClinician.map((c) => (
                    <li key={c.clinicianName} className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{c.clinicianName}</span>
                      <span className="text-slate-500">
                        <span className="font-semibold tabular-nums text-rose-700">{c.count}</span> · oldest {c.oldestDays}d
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {ops.staff.invitedNotActive ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <UserPlus size={12} aria-hidden /> {ops.staff.invitedNotActive} staff invited but not activated: practice leadership can resend the invite from Admin.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
