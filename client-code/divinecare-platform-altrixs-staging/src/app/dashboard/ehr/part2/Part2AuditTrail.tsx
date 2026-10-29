'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Lock } from 'lucide-react';
import { actionLabel, describeResource, outcomeLabel, sensitiveAccessLabel } from '@/lib/audit/auditLabels';
import { cardClasses, cx } from '@/components/ui';

type Part2ClientRow = { id: string; label: string; mrn: string | null; locked: boolean; sources: string[] };

type TrailData = {
  page: number;
  pageSize: number;
  total: number;
  denied: number;
  clients: Part2ClientRow[];
  events: {
    id: string;
    createdAt: string;
    actorName: string | null;
    actorRole: string | null;
    action: string;
    resourceType: string | null;
    patientId: string | null;
    clientLabel: string | null;
    outcome: string;
  }[];
  sensitiveAccess: { id: string; clientId: string; clientLabel: string | null; userName: string | null; accessType: string; timestamp: string }[];
};

/** Entries typed into the old browser-editable list. Shown read-only, never treated as audit data. */
export type LegacyPart2AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  clientName: string;
  performedBy: string;
  disclosedTo?: string;
  consentVerified: boolean;
  notes: string;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Real audit trail for 42 CFR Part 2 clients (GET /api/part2/audit-trail), read-only.
 * Admin / Practice Director only — the same rule as protected-record access logs.
 */
export function Part2AuditTrail({
  privileged,
  legacy,
  onDeniedCount,
}: {
  privileged: boolean;
  legacy: LegacyPart2AuditEntry[];
  onDeniedCount?: (n: number) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TrailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!privileged) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page) });
      if (clientId) qs.set('clientId', clientId);
      const res = await fetch(`/api/part2/audit-trail?${qs}`, { cache: 'no-store' });
      const d = (await res.json().catch(() => null)) as ({ success?: boolean; error?: string } & Partial<TrailData>) | null;
      if (!res.ok || !d?.success) throw new Error(d?.error || 'Could not load the Part 2 audit trail');
      setData(d as TrailData);
      if (!clientId) onDeniedCount?.(d.denied ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the Part 2 audit trail');
    } finally {
      setLoading(false);
    }
  }, [privileged, page, clientId, onDeniedCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className={cx(cardClasses, 'overflow-hidden')}>
        <div className="px-5 py-4 border-b border-slate-200/80 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Access audit trail — Part 2 clients</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              From the HIPAA audit log and the protected-record access log. Read-only; entries cannot be edited or deleted.
            </p>
          </div>
          {privileged && data?.clients.length ? (
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              Client
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All Part 2 clients ({data.clients.length})</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.mrn ? ` · ${c.mrn}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {!privileged ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            <Lock size={18} className="mx-auto mb-2 text-slate-500" />
            The Part 2 audit trail is visible to the Admin and Practice Director only.
          </div>
        ) : error ? (
          <div className="px-5 py-10 text-center text-sm text-rose-700">{error}</div>
        ) : !data ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">{loading ? 'Loading…' : ''}</div>
        ) : data.clients.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No Part 2 clients yet. A client counts as Part 2 when their protected record is classified Part 2 / 42 CFR / SUD, a
            progress note is flagged Part 2, or a Part 2 disclosure is recorded for them.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.sensitiveAccess.length ? (
              <div className="px-5 py-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Protected record opens</p>
                <ul className="space-y-1 text-xs text-slate-700">
                  {data.sensitiveAccess.slice(0, 50).map((s) => (
                    <li key={s.id} className={s.accessType === 'denied' ? 'text-rose-700' : ''}>
                      {fmt(s.timestamp)} · <span className="font-semibold">{s.userName || 'Unknown user'}</span> ·{' '}
                      {sensitiveAccessLabel(s.accessType)} · {s.clientLabel || 'Unknown client'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              {data.events.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">No audit events for {clientId ? 'this client' : 'Part 2 clients'} yet.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase text-slate-600">
                      <th scope="col" className="px-4 py-2">When</th>
                      <th scope="col" className="px-4 py-2">Who</th>
                      <th scope="col" className="px-4 py-2">Action</th>
                      <th scope="col" className="px-4 py-2">Record</th>
                      <th scope="col" className="px-4 py-2">Client</th>
                      <th scope="col" className="px-4 py-2">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.events.map((e) => (
                      <tr key={e.id} className={e.outcome === 'DENIED' ? 'bg-rose-50/40' : ''}>
                        <td className="whitespace-nowrap px-4 py-1.5">{fmt(e.createdAt)}</td>
                        <td className="px-4 py-1.5">
                          {e.actorName || '—'} <span className="text-slate-500">{e.actorRole || ''}</span>
                        </td>
                        <td className="px-4 py-1.5" title={e.action}>{actionLabel(e.action)}</td>
                        <td className="px-4 py-1.5">{describeResource(e.resourceType)}</td>
                        <td className="px-4 py-1.5">{e.clientLabel || '—'}</td>
                        <td className="px-4 py-1.5">
                          <span className={e.outcome === 'SUCCESS' ? 'text-slate-600' : 'font-semibold text-rose-700'}>{outcomeLabel(e.outcome)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center justify-between px-5 py-3 text-xs text-slate-500">
              <span>
                {data.total.toLocaleString()} event{data.total === 1 ? '' : 's'} · page {page} of {pageCount}
                {clientId ? (
                  <>
                    {' · '}
                    <Link href={`/dashboard/admin/audit-log?patientId=${encodeURIComponent(clientId)}`} className="font-semibold text-blue-700 hover:underline">
                      Open in HIPAA audit log
                    </Link>
                  </>
                ) : null}
              </span>
              <div className="flex gap-2">
                <button type="button" className="clinic-btn-secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                  Newer
                </button>
                <button type="button" className="clinic-btn-secondary" disabled={page >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>
                  Older
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {legacy.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-200">
            <h3 className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
              <AlertTriangle size={14} /> Legacy entries (typed in before Oct 2026)
            </h3>
            <p className="text-xs text-amber-800 mt-0.5">
              Notes kept in the old editable list on this page. They were typed by hand, are not part of the audit trail and are
              not recorded disclosures. Shown read-only for reference.
            </p>
          </div>
          <ul className="divide-y divide-amber-100 text-xs text-slate-700">
            {legacy.map((e) => (
              <li key={e.id} className="px-5 py-2">
                <span className="font-mono text-slate-500">{e.timestamp}</span> · <span className="font-semibold">{e.clientName}</span> · {e.action}
                {e.disclosedTo ? ` · to ${e.disclosedTo}` : ''} · {e.performedBy}
                {e.notes ? <span className="block text-slate-500">{e.notes}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
