'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Phone,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  TrendingUp,
  FileEdit,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import ClaimEditorModal, { EditableClaim } from '@/components/ClaimEditorModal';
import { ValantArPanel } from '@/components/billing/ValantArPanel';

type AgingBucketKey = '0-30' | '31-60' | '61-90' | '91-120' | '120+';

type ArSnapshot = {
  schemaReady: boolean;
  syncedAt: string;
  eraMode: 'waystar' | 'demo';
  kpis: {
    totalArCents: number;
    over90Cents: number;
    activeDenials: number;
    inAppeal: number;
    firstPassRate: number | null;
    firstPassAccepted: number;
    firstPassTotal: number;
  };
  aging: Array<{
    key: AgingBucketKey;
    label: string;
    color: string;
    count: number;
    amountCents: number;
  }>;
  byPayer: Array<{ payer: string; count: number; amountCents: number; color: string }>;
  worklist: Array<{
    claimId: string;
    displayId: string;
    clientId: string;
    clientName: string;
    payer: string;
    cptCode: string;
    amountCents: number;
    status: string;
    daysOutstanding: number;
    agingBucket: AgingBucketKey;
    denialId: string | null;
    denialStatus: string | null;
    lastContactAt: string | null;
    serviceDate: string | null;
  }>;
};

const PURPLE = '#5C2D91';
const CTA = { background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' };

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ArControlPage() {
  const [data, setData] = useState<ArSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [agingFilter, setAgingFilter] = useState<AgingBucketKey | 'all'>('all');
  const [payerFilter, setPayerFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [editingClaim, setEditingClaim] = useState<EditableClaim | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<ArSnapshot & { success: true }>('/api/billing/ar');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load A/R');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const payers = useMemo(() => data?.byPayer.map((p) => p.payer) ?? [], [data]);

  const filtered = useMemo(() => {
    const rows = data?.worklist ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (agingFilter !== 'all' && row.agingBucket !== agingFilter) return false;
      if (payerFilter !== 'all' && row.payer !== payerFilter) return false;
      if (!q) return true;
      return `${row.clientName} ${row.payer} ${row.displayId} ${row.cptCode}`.toLowerCase().includes(q);
    });
  }, [data, query, agingFilter, payerFilter]);

  const maxPayer = Math.max(1, ...(data?.byPayer.map((p) => p.amountCents) ?? [1]));
  const maxAging = Math.max(1, ...(data?.aging.map((a) => a.amountCents) ?? [1]));

  async function runAction(claimId: string, action: 'log_call' | 'resubmit' | 'send_statement') {
    setBusy(`${claimId}:${action}`);
    setActionMsg(null);
    try {
      const res = await apiJson<{
        success: true;
        href?: string;
        statementId?: string;
      }>('/api/billing/ar/action', {
        method: 'POST',
        body: JSON.stringify({ claimId, action }),
      });
      if (res.href && (action === 'resubmit' || action === 'send_statement')) {
        window.location.href = res.href;
        return;
      }
      setActionMsg(
        action === 'log_call' ? 'Call logged on claim.' : 'Action completed.'
      );
      await load();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  async function syncEra() {
    setBusy('sync-era');
    setActionMsg(null);
    try {
      const res = await apiJson<{ success: true; message?: string; syncedAt?: string }>(
        '/api/billing/ar/sync-era',
        { method: 'POST' }
      );
      setActionMsg(res.message || 'ERA sync completed.');
      await load();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'ERA sync failed');
    } finally {
      setBusy(null);
    }
  }

  const kpis = data?.kpis;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: PURPLE }}>
            Billing
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-[#141C34]">A/R Control Center</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live receivables from claims &amp; ERA — follow up, resubmit, and statement in one worklist.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/billing/ar/export"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Download size={16} /> Export CSV
          </a>
          <button
            type="button"
            disabled={busy === 'sync-era'}
            onClick={() => void syncEra()}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
            style={CTA}
          >
            <RefreshCw size={16} className={busy === 'sync-era' ? 'animate-spin' : ''} />
            Sync ERA
          </button>
        </div>
      </div>

      <ValantArPanel />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      {actionMsg && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {actionMsg}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          {
            label: 'Total A/R',
            value: money(kpis?.totalArCents ?? 0),
            color: PURPLE,
            icon: TrendingUp,
          },
          {
            label: 'Over 90 Days',
            value: money(kpis?.over90Cents ?? 0),
            color: '#7C2D12',
            icon: AlertTriangle,
          },
          {
            label: 'Active Denials',
            value: String(kpis?.activeDenials ?? 0),
            color: '#DC2626',
            icon: ShieldAlert,
          },
          {
            label: 'In Appeal',
            value: String(kpis?.inAppeal ?? 0),
            color: '#7C3AED',
            icon: Send,
          },
          {
            label: 'First-Pass Rate',
            value:
              kpis?.firstPassRate == null
                ? '—'
                : `${kpis.firstPassRate}%`,
            color: '#15803D',
            icon: TrendingUp,
            sub:
              kpis && kpis.firstPassTotal > 0
                ? `${kpis.firstPassAccepted}/${kpis.firstPassTotal} clean`
                : 'No decided claims yet',
          },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
              style={{ backgroundColor: kpi.color }}
            >
              <kpi.icon size={16} strokeWidth={2.4} />
            </div>
            <p className="mt-3 text-2xl font-black tracking-tight" style={{ color: kpi.color }}>
              {loading ? '…' : kpi.value}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">{kpi.label}</p>
            {'sub' in kpi && kpi.sub ? (
              <p className="mt-1 text-[11px] text-slate-400">{kpi.sub}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-400">Aging buckets</h2>
          <div className="mt-4 space-y-3">
            {(data?.aging ?? []).map((bucket) => (
              <button
                key={bucket.key}
                type="button"
                onClick={() =>
                  setAgingFilter((prev) => (prev === bucket.key ? 'all' : bucket.key))
                }
                className="w-full text-left"
              >
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-[#141C34]">{bucket.label}</span>
                  <span className="text-slate-500">
                    {bucket.count} · {money(bucket.amountCents)}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(bucket.amountCents > 0 ? 8 : 0, (bucket.amountCents / maxAging) * 100)}%`,
                      backgroundColor: bucket.color,
                    }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-400">By payer</h2>
          <div className="mt-4 space-y-3">
            {(data?.byPayer ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No open A/R by payer yet.</p>
            ) : (
              data!.byPayer.slice(0, 8).map((row) => (
                <button
                  key={row.payer}
                  type="button"
                  onClick={() =>
                    setPayerFilter((prev) => (prev === row.payer ? 'all' : row.payer))
                  }
                  className="w-full text-left"
                >
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-[#141C34]">{row.payer}</span>
                    <span className="text-slate-500">
                      {row.count} · {money(row.amountCents)}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(8, (row.amountCents / maxPayer) * 100)}%`,
                        backgroundColor: PURPLE,
                      }}
                    />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-black text-[#141C34]">Collections worklist</h2>
          <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search client, payer, claim…"
              className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            />
          </div>
          <select
            value={agingFilter}
            onChange={(e) => setAgingFilter(e.target.value as AgingBucketKey | 'all')}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All aging</option>
            {(data?.aging ?? []).map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
          <select
            value={payerFilter}
            onChange={(e) => setPayerFilter(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All payers</option>
            {payers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Loading A/R worklist…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No A/R items match your filters
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((row) => {
              const open = expanded === row.claimId;
              const bucketColor =
                data?.aging.find((a) => a.key === row.agingBucket)?.color || '#64748b';
              return (
                <li key={row.claimId} className="px-5 py-4">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-3 text-left"
                    onClick={() => setExpanded(open ? null : row.claimId)}
                  >
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
                      style={{ backgroundColor: bucketColor }}
                    >
                      {row.agingBucket} · {row.daysOutstanding}d
                    </span>
                    <span className="font-bold text-[#141C34]">{row.clientName}</span>
                    <span className="text-sm text-slate-500">{row.payer}</span>
                    <span className="text-sm text-slate-400">{row.displayId}</span>
                    <span className="ml-auto font-black" style={{ color: PURPLE }}>
                      {money(row.amountCents)}
                    </span>
                  </button>
                  {open && (
                    <div className="mt-3 rounded-xl bg-slate-50 p-4">
                      <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                        <p>
                          CPT <span className="font-semibold text-slate-900">{row.cptCode}</span>
                        </p>
                        <p>
                          Status <span className="font-semibold text-slate-900">{row.status}</span>
                        </p>
                        <p>
                          Last contact{' '}
                          <span className="font-semibold text-slate-900">
                            {row.lastContactAt ? formatTs(row.lastContactAt) : '—'}
                          </span>
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy === `${row.claimId}:log_call`}
                          onClick={() => void runAction(row.claimId, 'log_call')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold"
                        >
                          <Phone size={14} /> Log Call
                        </button>
                        <button
                          type="button"
                          disabled={busy === `${row.claimId}:resubmit`}
                          onClick={() => void runAction(row.claimId, 'resubmit')}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                          style={CTA}
                        >
                          Resubmit
                        </button>
                        {row.denialId ? (
                          <Link
                            href="/dashboard/billing/denials"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800"
                          >
                            View Appeal
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy === `${row.claimId}:send_statement`}
                          onClick={() => void runAction(row.claimId, 'send_statement')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold"
                        >
                          <Send size={14} /> Send Statement
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingClaim({
                              id: row.claimId,
                              claimNumber: row.displayId,
                              client: row.clientName,
                              dos: row.serviceDate || new Date().toISOString().split('T')[0],
                              payer: row.payer,
                              renderingProvider: 'Not on file',
                              billingProvider: 'MD Behavioral Health — Group NPI 1457893210 · TIN 82-1234567',
                              authNumber: '',
                              pos: '11',
                              icd10: 'F33.1',
                              lines: [
                                { cpt: row.cptCode, modifier: '', units: 1, charge: row.amountCents / 100 }
                              ],
                              totalCharge: row.amountCents / 100,
                              status: (row.status as any) || 'SUBMITTED',
                            });
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-800 hover:bg-purple-100"
                        >
                          <FileEdit size={14} /> Edit Claim
                        </button>
                        <Link
                          href={`/dashboard/billing/claims?claimId=${row.claimId}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold"
                        >
                          View Claim
                        </Link>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-center text-xs text-slate-400">
        Synced via Waystar ERA ·{' '}
        {data?.eraMode === 'waystar' ? formatTs(data.syncedAt) : 'Demo'}
      </p>

      {/* ClaimEditorModal Integration */}
      {editingClaim && (
        <ClaimEditorModal
          claim={editingClaim}
          isOpen={true}
          onClose={() => setEditingClaim(null)}
          onSave={updated => {
            if (data && editingClaim) {
              setData(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  worklist: prev.worklist.map(w => w.claimId === editingClaim.id ? {
                    ...w,
                    payer: updated.payer,
                    amountCents: Math.round((updated.totalCharge ?? (row => row.amountCents / 100)(w)) * 100),
                  } : w)
                };
              });
              setActionMsg(`Claim ${editingClaim.claimNumber || editingClaim.id} updated in Claim Editor.`);
            }
            setEditingClaim(null);
          }}
        />
      )}
    </div>
  );
}
