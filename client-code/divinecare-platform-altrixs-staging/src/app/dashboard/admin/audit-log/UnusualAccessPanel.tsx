'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Clock, KeyRound, Lock, ShieldAlert, TrendingUp } from 'lucide-react';
import { Alert, LoadingState } from '@/components/ui';
import { actionLabel, describeResource, sensitiveAccessLabel } from '@/lib/audit/auditLabels';

type ClientRef = { label: string; mrn: string | null; protected: boolean; locked: boolean } | null;

type Report = {
  generatedAt: string;
  timeZone: string;
  rules: Record<'highVolume' | 'afterHours' | 'protectedAccess' | 'breakGlass' | 'denied', string>;
  highVolume: { userId: string; userName: string | null; today: number; averagePerActiveDay: number | null; activeDays: number; reason: string }[];
  afterHours: { userId: string; userName: string | null; count: number; lastAt: string }[];
  protectedAccess: { userId: string; userName: string | null; clientId: string; client: ClientRef; accessType: string; count: number; lastAt: string }[];
  breakGlass: { id: string; userId: string; userName: string | null; clientId: string; client: ClientRef; reason: string; grantedAt: string; expiresAt: string; active: boolean }[];
  denied: { id: string; source: 'audit' | 'protected'; userId: string | null; userName: string | null; action: string; resourceType: string | null; clientId: string | null; client: ClientRef; at: string }[];
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Section({
  icon,
  title,
  rule,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  rule: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span aria-hidden className="mt-0.5 text-slate-500">{icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500">{rule}</p>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${count ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' : 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'}`}
        >
          {count}
        </span>
      </div>
      {count ? <ul className="divide-y divide-slate-100 text-xs text-slate-700">{children}</ul> : <p className="text-xs text-slate-500">Nothing to review.</p>}
    </div>
  );
}

function clientText(c: ClientRef, id: string | null) {
  if (!id) return null;
  if (!c) return <span className="font-mono text-slate-500">{id}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {c.protected ? <Lock size={12} className="text-rose-600" aria-label="Protected record" /> : null}
      {c.label}
      {c.mrn ? <span className="font-mono text-slate-500">{c.mrn}</span> : null}
    </span>
  );
}

/** Read-only, rule-based unusual-access review (GET /api/admin/audit-log/unusual). */
export function UnusualAccessPanel({ onFilterUser }: { onFilterUser?: (userId: string) => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/audit-log/unusual', { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as ({ success?: boolean; error?: string } & Partial<Report>) | null;
        if (!r.ok || !d?.success) throw new Error(d?.error || 'Could not load unusual-access review');
        if (!cancelled) setReport(d as Report);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load unusual-access review');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const who = (id: string | null, name: string | null) =>
    id && onFilterUser ? (
      <button type="button" className="rounded font-semibold text-slate-900 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => onFilterUser(id)}>
        {name || id}
      </button>
    ) : (
      <span className="font-semibold text-slate-900">{name || id || 'Unknown user'}</span>
    );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Unusual access review</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Simple, fixed rules over the audit trail — a starting point for review, not a finding of wrongdoing. Times are Eastern.
        </p>
      </div>
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !report ? (
        <LoadingState label="Loading review…" className="py-6" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section icon={<TrendingUp size={16} />} title="High PHI read volume" rule={report.rules.highVolume} count={report.highVolume.length}>
            {report.highVolume.map((h) => (
              <li key={h.userId} className="py-1.5">
                {who(h.userId, h.userName)} · {h.reason}
              </li>
            ))}
          </Section>
          <Section icon={<Clock size={16} />} title="After-hours access" rule={report.rules.afterHours} count={report.afterHours.length}>
            {report.afterHours.map((a) => (
              <li key={a.userId} className="py-1.5">
                {who(a.userId, a.userName)} · {a.count} event{a.count === 1 ? '' : 's'} · latest {when(a.lastAt)}
              </li>
            ))}
          </Section>
          <Section icon={<Lock size={16} />} title="Protected / Part 2 record access" rule={report.rules.protectedAccess} count={report.protectedAccess.length}>
            {report.protectedAccess.map((p) => (
              <li key={`${p.userId}-${p.clientId}-${p.accessType}`} className="py-1.5">
                {who(p.userId, p.userName)} · {clientText(p.client, p.clientId)} · {sensitiveAccessLabel(p.accessType)} ×{p.count} · latest {when(p.lastAt)}
              </li>
            ))}
          </Section>
          <Section icon={<KeyRound size={16} />} title="Break-the-glass grants" rule={report.rules.breakGlass} count={report.breakGlass.length}>
            {report.breakGlass.map((g) => (
              <li key={g.id} className="py-1.5">
                {who(g.userId, g.userName)} · {clientText(g.client, g.clientId)} · {when(g.grantedAt)}
                {g.active ? <span className="ml-1 rounded bg-amber-50 px-1 text-amber-800">active until {when(g.expiresAt)}</span> : null}
                <span className="block text-slate-500">Reason: {g.reason}</span>
              </li>
            ))}
          </Section>
          <div className="lg:col-span-2">
            <Section icon={<ShieldAlert size={16} />} title="Denied requests" rule={report.rules.denied} count={report.denied.length}>
              {report.denied.slice(0, 50).map((d) => (
                <li key={`${d.source}-${d.id}`} className="flex flex-wrap items-center gap-x-1 py-1.5">
                  <AlertTriangle size={12} className="text-rose-600" aria-hidden />
                  {when(d.at)} · {who(d.userId, d.userName)} · {actionLabel(d.action)} · {describeResource(d.resourceType)}
                  {d.clientId ? <> · {clientText(d.client, d.clientId)}</> : null}
                </li>
              ))}
            </Section>
          </div>
        </div>
      )}
    </section>
  );
}
