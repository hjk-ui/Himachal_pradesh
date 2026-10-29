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
  Archive,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import ClaimEditorModal, { EditableClaim } from '@/components/ClaimEditorModal';
import { useAuth } from '@/features/auth';
import { canEditClaims } from '@/lib/billing/billingAccess';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { FILTER_BAR, FILTER_SEARCH, FILTER_SELECT } from '@/features/billing/tableLayout';
import ValantRunoutSection, {
  DEFAULT_VALANT_QUERY,
  valantQueryString,
  type ValantQuery,
  type ValantRunout,
} from './ValantRunoutSection';
import {
  Alert, Button, Card, CardBody, CardHeader, EmptyState, LoadingState, Page, PageHeader, Section, StatusBadge,
  buttonClasses, cx, FOCUS_RING, inputClasses, TONE_SOFT, type Tone,
} from '@/components/ui';

type AgingBucketKey = '0-30' | '31-60' | '61-90' | '91-120' | '120+';

type ArSnapshot = {
  schemaReady: boolean;
  syncedAt: string;
  eraMode: 'waystar' | 'demo';
  claimCount: number;
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

/** Aging bucket colour by meaning (older = more urgent); badge tone and bar fill. */
const AGING_TONE: Record<AgingBucketKey, Tone> = {
  '0-30': 'success',
  '31-60': 'info',
  '61-90': 'warning',
  '91-120': 'danger',
  '120+': 'danger',
};
const AGING_BAR: Record<AgingBucketKey, string> = {
  '0-30': 'bg-emerald-500',
  '31-60': 'bg-sky-500',
  '61-90': 'bg-amber-500',
  '91-120': 'bg-rose-500',
  '120+': 'bg-rose-700',
};

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
  const { user } = useAuth();
  // Resubmit, ERA sync and claim edits are billing core only (canMutateClaims on the API);
  // Office Manager keeps Log Call / Send Statement and View Claim.
  const canEdit = canEditClaims(user?.role);
  const canOpenClaims = canAccessPath(user?.role, '/dashboard/billing/claims');
  const [valant, setValant] = useState<ValantRunout | null>(null);
  const [valantLoading, setValantLoading] = useState(true);
  const [valantQuery, setValantQuery] = useState<ValantQuery>(DEFAULT_VALANT_QUERY);
  const [valantError, setValantError] = useState<string | null>(null);

  const valantQs = valantQueryString(valantQuery);
  useEffect(() => {
    let cancelled = false;
    setValantLoading(true);
    // Debounced so typing in search / min amount does not fire a request per key
    const t = window.setTimeout(async () => {
      try {
        const res = await apiJson<ValantRunout & { success: true }>(`/api/billing/ar/valant${valantQs ? `?${valantQs}` : ''}`);
        if (!cancelled) {
          setValant(res);
          setValantError(null);
        }
      } catch (err) {
        if (!cancelled) setValantError(err instanceof Error ? err.message : 'Could not load Valant run-out A/R');
      } finally {
        if (!cancelled) setValantLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [valantQs]);

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
        window.location.assign(res.href);
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
    <Page>
      <PageHeader
        eyebrow="Billing"
        title="A/R Control Center"
        description={<>Altrixs claim receivables (claims &amp; ERA) and the Valant run-out, side by side — never added together.</>}
        actions={<>
          <a
            href="/api/billing/ar/export"
            className={buttonClasses({ variant: 'secondary' })}
          >
            <Download size={16} aria-hidden /> Export claims CSV
          </a>
          {canEdit && (
          <button
            type="button"
            disabled={busy === 'sync-era'}
            onClick={() => void syncEra()}
            className={buttonClasses({ variant: 'primary' })}
          >
            <RefreshCw size={16} aria-hidden className={busy === 'sync-era' ? 'animate-spin' : ''} />
            Sync ERA
          </button>
          )}
        </>}
      />

      {error && (
        <Alert tone="danger" actions={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}
      {actionMsg && (
        <Alert tone="neutral">
          {actionMsg}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Altrixs claims A/R" icon={<TrendingUp />} />
          <CardBody>
          {!loading && data && data.claimCount === 0 ? (
            <EmptyState
              compact
              title="No Altrixs claims yet — claims start after go-live"
              description="Claim A/R, denials and first-pass rate appear here once Altrixs bills its first claims."
              className="rounded-lg border border-dashed border-slate-300 bg-slate-50"
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 2xl:grid-cols-5">
              {[
                {
                  label: 'Claims A/R',
                  value: money(kpis?.totalArCents ?? 0),
                  tone: 'brand' as Tone,
                  icon: TrendingUp,
                },
                {
                  label: 'Over 90 Days',
                  value: money(kpis?.over90Cents ?? 0),
                  tone: 'warning' as Tone,
                  icon: AlertTriangle,
                },
                {
                  label: 'Active Denials',
                  value: String(kpis?.activeDenials ?? 0),
                  tone: 'danger' as Tone,
                  icon: ShieldAlert,
                },
                {
                  label: 'In Appeal',
                  value: String(kpis?.inAppeal ?? 0),
                  tone: 'info' as Tone,
                  icon: Send,
                },
                {
                  label: 'First-Pass Rate',
                  value:
                    kpis?.firstPassRate == null
                      ? '—'
                      : `${kpis.firstPassRate}%`,
                  tone: 'success' as Tone,
                  icon: TrendingUp,
                  sub:
                    kpis && kpis.firstPassTotal > 0
                      ? `${kpis.firstPassAccepted}/${kpis.firstPassTotal} clean`
                      : 'No decided claims yet',
                },
              ].map((kpi) => (
                <div key={kpi.label} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                  <span
                    aria-hidden
                    className={cx('flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset', TONE_SOFT[kpi.tone])}
                  >
                    <kpi.icon size={16} />
                  </span>
                  <p className="stat-number mt-2 break-words text-xl font-semibold tracking-tight text-slate-900">
                    {loading ? '…' : kpi.value}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">{kpi.label}</p>
                  {'sub' in kpi && kpi.sub ? (
                    <p className="mt-1 text-xs text-slate-500">{kpi.sub}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Valant run-out A/R" icon={<Archive />} />
          <CardBody>
          {valantError ? (
            <Alert tone="danger">{valantError}</Alert>
          ) : !valant ? (
            <LoadingState label="Loading…" className="py-6" />
          ) : !valant.available ? (
            <p className="text-sm text-slate-500">No Valant aging imported yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                {[
                  { label: 'Insurance A/R', t: valant.totals.insurance, asOf: valant.asOf.insurance },
                  { label: 'Patient A/R', t: valant.totals.patient, asOf: valant.asOf.patient },
                  { label: 'Total Valant A/R', t: valant.totals.all, asOf: null },
                ].map((k) => (
                  <div key={k.label} className="min-w-0 rounded-lg border border-slate-200 p-3">
                    <p className="stat-number break-words text-xl font-semibold tracking-tight text-slate-900">
                      {k.t ? money(k.t.totalCents) : '—'}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">{k.label}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {k.label === 'Total Valant A/R' ? 'Insurance + patient' : k.t ? `As of ${k.asOf}` : 'Not imported'}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-600">{valant.note}</p>
              <p className="mt-1 text-xs text-slate-500">
                Patient balances can be posted to the Altrixs ledger from{' '}
                <Link href="/dashboard/billing/valant-balances" className="font-semibold text-blue-700 hover:underline">
                  Valant Balances
                </Link>
                ; insurance A/R is never posted into Altrixs claims.
              </p>
            </>
          )}
          </CardBody>
        </Card>
      </div>

      <ValantRunoutSection
        data={valant}
        loading={valantLoading}
        query={valantQuery}
        onQuery={(next) => setValantQuery((prev) => ({ ...prev, ...next }))}
      />

      {(data?.claimCount ?? 0) > 0 ? (
        <Section title="Altrixs claims">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Aging buckets" titleAs="h3" />
          <CardBody className="space-y-3">
            {(data?.aging ?? []).map((bucket) => (
              <button
                key={bucket.key}
                type="button"
                aria-pressed={agingFilter === bucket.key}
                onClick={() =>
                  setAgingFilter((prev) => (prev === bucket.key ? 'all' : bucket.key))
                }
                className={cx('w-full rounded-lg text-left', FOCUS_RING)}
              >
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-slate-900">{bucket.label}</span>
                  <span className="shrink-0 whitespace-nowrap text-slate-500">
                    {bucket.count} · {money(bucket.amountCents)}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cx('h-full rounded-full transition-all', AGING_BAR[bucket.key] ?? 'bg-slate-400')}
                    style={{
                      width: `${Math.max(bucket.amountCents > 0 ? 8 : 0, (bucket.amountCents / maxAging) * 100)}%`,
                    }}
                  />
                </div>
              </button>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="By payer" titleAs="h3" />
          <CardBody className="space-y-3">
            {(data?.byPayer ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No open A/R by payer yet.</p>
            ) : (
              data!.byPayer.slice(0, 8).map((row) => (
                <button
                  key={row.payer}
                  type="button"
                  aria-pressed={payerFilter === row.payer}
                  onClick={() =>
                    setPayerFilter((prev) => (prev === row.payer ? 'all' : row.payer))
                  }
                  className={cx('w-full rounded-lg text-left', FOCUS_RING)}
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium text-slate-900" title={row.payer}>{row.payer}</span>
                    <span className="shrink-0 whitespace-nowrap text-slate-500">
                      {row.count} · {money(row.amountCents)}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{
                        width: `${Math.max(8, (row.amountCents / maxPayer) * 100)}%`,
                      }}
                    />
                  </div>
                </button>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <div className={cx(FILTER_BAR, 'gap-3 border-b border-slate-200 px-4 py-4 sm:px-5')}>
          <h3 className="text-sm font-semibold text-slate-900 sm:mr-auto">Collections worklist</h3>
          <div className={cx(FILTER_SEARCH, 'sm:max-w-sm')}>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search client, payer, claim…"
              aria-label="Search client, payer, claim"
              className={cx(inputClasses, 'pl-9')}
            />
          </div>
          <select
            value={agingFilter}
            onChange={(e) => setAgingFilter(e.target.value as AgingBucketKey | 'all')}
            aria-label="Filter by aging"
            className={cx(inputClasses, FILTER_SELECT)}
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
            aria-label="Filter by payer"
            className={cx(inputClasses, FILTER_SELECT)}
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
          <LoadingState label="Loading A/R worklist…" />
        ) : filtered.length === 0 ? (
          <EmptyState compact title="No A/R items match your filters" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((row) => {
              const open = expanded === row.claimId;
              return (
                <li key={row.claimId} className="px-4 py-4 sm:px-5">
                  <button
                    type="button"
                    aria-expanded={open}
                    className={cx('flex w-full flex-wrap items-center gap-3 rounded-lg text-left', FOCUS_RING)}
                    onClick={() => setExpanded(open ? null : row.claimId)}
                  >
                    <StatusBadge tone={AGING_TONE[row.agingBucket] ?? 'neutral'} size="sm">
                      {row.agingBucket} · {row.daysOutstanding}d
                    </StatusBadge>
                    <span className="font-semibold text-slate-900">{row.clientName}</span>
                    <span className="text-sm text-slate-500">{row.payer}</span>
                    <span className="text-sm text-slate-500">{row.displayId}</span>
                    <span className="ml-auto font-semibold tabular-nums text-slate-900">
                      {money(row.amountCents)}
                    </span>
                  </button>
                  {open && (
                    <div className="mt-3 rounded-lg bg-slate-50 p-4">
                      <div className="grid grid-cols-1 gap-2 text-sm text-slate-600 sm:grid-cols-3">
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
                          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        >
                          <Phone size={14} aria-hidden /> Log Call
                        </button>
                        {canEdit && (
                        <button
                          type="button"
                          disabled={busy === `${row.claimId}:resubmit`}
                          onClick={() => void runAction(row.claimId, 'resubmit')}
                          className={buttonClasses({ variant: 'primary', size: 'sm' })}
                        >
                          Resubmit
                        </button>
                        )}
                        {row.denialId ? (
                          <Link
                            href="/dashboard/billing/denials"
                            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                          >
                            View Appeal
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy === `${row.claimId}:send_statement`}
                          onClick={() => void runAction(row.claimId, 'send_statement')}
                          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        >
                          <Send size={14} aria-hidden /> Send Statement
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
                              renderingProvider: '',
                              billingProvider: 'MD Behavioral Health',
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
                          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                        >
                          <FileEdit size={14} aria-hidden /> {canEdit ? 'Edit Claim' : 'Claim Details'}
                        </button>
                        {canOpenClaims && (
                        <Link
                          href={`/dashboard/billing/claims?claimId=${row.claimId}`}
                          className={buttonClasses({ variant: 'ghost', size: 'sm' })}
                        >
                          View Claim
                        </Link>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

        </Section>
      ) : null}

      <p className="text-center text-xs text-slate-500">
        Synced via Waystar ERA ·{' '}
        {data?.eraMode === 'waystar' ? formatTs(data.syncedAt) : 'Demo'}
      </p>

      {/* ClaimEditorModal Integration */}
      {editingClaim && (
        <ClaimEditorModal
          claim={editingClaim}
          isOpen={true}
          onClose={() => setEditingClaim(null)}
          onSave={() => {
            // Called only after the claim was saved; reload the worklist from the server.
            setActionMsg(`Claim ${editingClaim.claimNumber || editingClaim.id} saved.`);
            setEditingClaim(null);
            void load();
          }}
        />
      )}
    </Page>
  );
}
