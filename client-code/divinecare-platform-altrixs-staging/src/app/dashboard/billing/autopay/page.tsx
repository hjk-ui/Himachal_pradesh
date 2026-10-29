'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Loader2, Plus, RefreshCw } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { saveAutopay, stubAutopayCharge } from '@/features/billing/ledgerApi';
import { formatCents } from '@/lib/migration/valantReportCommon';
import { DEFAULT_PRACTICE_TIME_ZONE, formatPracticeDate, practiceZoneLabel } from '@/lib/time/practiceTime';
import { PracticePlanBanner } from '@/components/subscription/PracticePlanBanner';
import { AutopayDrawer } from '@/components/billing/autopay/AutopayDrawer';
import { CardCell, SourceChip, StatusChip } from '@/components/billing/autopay/AutopayChips';
import { EnrollClientDialog } from '@/components/billing/autopay/EnrollClientDialog';
import { RowActionsMenu, type RowAction } from '@/components/billing/autopay/RowActionsMenu';
import { AutopayChargesPanel } from '@/components/billing/autopay/AutopayChargesPanel';
import { AutopaySettingsPanel, type PatientPaymentsStatus } from '@/components/billing/autopay/AutopaySettingsPanel';
import { CardSetupDialog } from '@/components/billing/autopay/CardSetupDialog';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  Tabs,
  buttonClasses,
  cx,
  inputClasses,
} from '@/components/ui';
import {
  TAB_LABEL,
  chargeAmountCents,
  computeKpis,
  deriveAutopay,
  formatBalance,
  inTab,
  planAmountLabel,
  planFrequencyLabel,
  sourceLabel,
  todayFor,
  type AutopayRow,
  type AutopayTab,
} from '@/components/billing/autopay/autopayLogic';
import { STICKY_ACTIONS_TD, STICKY_ACTIONS_TH, STICKY_FIRST_TD, STICKY_FIRST_TH } from '@/features/billing/tableLayout';

/**
 * Billing → AutoPay. Enrollments (Altrixs and imported from Valant), with card on file (brand, last 4,
 * expiry only), ledger balance and plan dates; patient payments status and settings (master switch,
 * default off); in-office card capture through Stripe Elements; automatic charges (pending / failed /
 * held / paid) with retry, approve, void and refund (src/lib/patientPayments). The stub charge is a
 * local-development test only and is never offered on staging or production.
 */

type AutopayResponse = {
  success: boolean;
  enrollments: AutopayRow[];
  schemaReady?: boolean;
  timeZone?: string;
  canMutate?: boolean;
  stubChargeAvailable?: boolean;
  error?: string;
};

const TABS: AutopayTab[] = ['all', 'active', 'attention', 'paused_ended', 'valant'];
const DATE_OPTS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
const NO_STRIPE_HINT = 'Patient card payments are off or Stripe is not connected (see the status above)';

function Kpi({ label, value, helper, tone }: { label: string; value: string; helper?: string; tone?: 'warn' }) {
  return (
    <StatCard
      label={label}
      value={value}
      hint={helper}
      tone={tone === 'warn' ? 'danger' : 'neutral'}
      icon={tone === 'warn' ? <AlertTriangle /> : undefined}
    />
  );
}

export default function AutopayPage() {
  const [data, setData] = useState<AutopayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<AutopayTab>('all');
  const [search, setSearch] = useState('');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [payStatus, setPayStatus] = useState<PatientPaymentsStatus | null>(null);
  const [cardFor, setCardFor] = useState<AutopayRow | null>(null);
  const [chargesKey, setChargesKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiJson<AutopayResponse>('/api/billing/autopay');
      if (!res.success) throw new Error(res.error || 'Could not load AutoPay');
      setData(res);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load AutoPay');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      setPayStatus(await apiJson<PatientPaymentsStatus>('/api/billing/autopay/settings'));
    } catch {
      setPayStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadStatus();
  }, [load, loadStatus]);

  const cardSetupReady = Boolean(payStatus?.settings.enabled && payStatus.configured && payStatus.authorizationTemplateReady);
  const cardHint = !payStatus?.settings.enabled || !payStatus.configured ? NO_STRIPE_HINT : !payStatus.authorizationTemplateReady ? 'Card authorization form needs approval in Consents' : undefined;

  const closeDrawer = useCallback(() => setDrawerId(null), []);
  const closeEnroll = useCallback(() => setEnrollOpen(false), []);

  const timeZone = data?.timeZone || DEFAULT_PRACTICE_TIME_ZONE;
  const zone = practiceZoneLabel(timeZone);
  const canMutate = Boolean(data?.canMutate);
  const stubAvailable = Boolean(data?.stubChargeAvailable);
  const today = useMemo(() => todayFor(timeZone), [timeZone]);
  const rows = useMemo(() => data?.enrollments ?? [], [data]);

  const derived = useMemo(() => new Map(rows.map((r) => [r.clientId, deriveAutopay(r, today)])), [rows, today]);
  const enrolled = useMemo(() => rows.filter((r) => derived.get(r.clientId)?.enrolled), [rows, derived]);
  const candidates = useMemo(() => rows.filter((r) => !derived.get(r.clientId)?.enrolled), [rows, derived]);
  const kpis = useMemo(() => computeKpis(rows, today, timeZone), [rows, today, timeZone]);

  const counts = useMemo(() => {
    const out = {} as Record<AutopayTab, number>;
    for (const t of TABS) out[t] = enrolled.filter((r) => inTab(t, r, derived.get(r.clientId)!)).length;
    return out;
  }, [enrolled, derived]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrolled.filter((r) => {
      if (!inTab(tab, r, derived.get(r.clientId)!)) return false;
      if (!q) return true;
      return r.clientName.toLowerCase().includes(q) || (r.mrn ?? '').toLowerCase().includes(q);
    });
  }, [enrolled, derived, tab, search]);

  const replaceRow = (clientId: string, patch: Partial<AutopayRow>) =>
    setData((prev) =>
      prev ? { ...prev, enrollments: prev.enrollments.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)) } : prev
    );

  const run = async (row: AutopayRow, fn: () => Promise<string | void>) => {
    setBusyId(row.clientId);
    setActionError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  };

  const setActive = (row: AutopayRow, active: boolean) =>
    run(row, async () => {
      // Pass last4 through: the API clears it when omitted
      const enrollment = await saveAutopay({ clientId: row.clientId, active, last4: row.last4 });
      replaceRow(row.clientId, enrollment);
      return active ? `AutoPay resumed for ${row.clientName}.` : `AutoPay paused for ${row.clientName}.`;
    });

  const enroll = (row: AutopayRow) =>
    run(row, async () => {
      const enrollment = await saveAutopay({ clientId: row.clientId, active: true, last4: row.last4 });
      replaceRow(row.clientId, enrollment);
      setEnrollOpen(false);
      setTab('all');
      return `${row.clientName} is enrolled. Save a card before anything can be charged.`;
    });

  const cancel = (row: AutopayRow) => {
    if (!window.confirm(`Cancel AutoPay for ${row.clientName}? The plan is marked Ended today; history is kept.`)) return;
    void run(row, async () => {
      await apiJson<{ success: boolean }>('/api/billing/autopay', {
        method: 'PATCH',
        body: JSON.stringify({ clientId: row.clientId, action: 'cancel' }),
      });
      await load();
      return `AutoPay cancelled for ${row.clientName}.`;
    });
  };

  const testCharge = (row: AutopayRow) => {
    const amountCents = chargeAmountCents(row);
    if (amountCents <= 0) {
      setNotice(`${row.clientName} has no balance due; nothing to charge.`);
      return;
    }
    if (
      !window.confirm(
        `TEST ONLY: post a ${formatCents(amountCents)} STUB payment for ${row.clientName}? No card is charged and no money moves, but the stub payment lowers the ledger balance.`
      )
    )
      return;
    void run(row, async () => {
      await stubAutopayCharge({ clientId: row.clientId, amountCents, last4: row.card?.last4 ?? row.last4 });
      await load();
      return `Test stub payment of ${formatCents(amountCents)} posted for ${row.clientName} (no money moved).`;
    });
  };

  const actionsFor = (row: AutopayRow): RowAction[] => {
    const d = derived.get(row.clientId)!;
    const noPerm = canMutate ? undefined : 'Billing or leadership role required';
    const list: RowAction[] = [{ key: 'view', label: 'View plan', onSelect: () => setDrawerId(row.clientId) }];
    if (!d.ended) {
      list.push(
        row.active
          ? { key: 'pause', label: 'Pause AutoPay', onSelect: () => void setActive(row, false), disabled: !canMutate, hint: noPerm }
          : { key: 'resume', label: 'Resume AutoPay', onSelect: () => void setActive(row, true), disabled: !canMutate, hint: noPerm },
        {
          key: 'card',
          label: d.needsCard ? 'Set up card (in office)' : 'Replace card (in office)',
          onSelect: () => setCardFor(row),
          disabled: !canMutate || !cardSetupReady,
          hint: noPerm ?? cardHint,
        }
      );
      if (stubAvailable) {
        list.push({
          key: 'stub',
          label: 'Test charge (dev only)',
          onSelect: () => testCharge(row),
          disabled: !canMutate || !row.active,
          hint: noPerm ?? (row.active ? undefined : 'AutoPay is paused'),
        });
      }
      list.push({ key: 'cancel', label: 'Cancel AutoPay', onSelect: () => cancel(row), disabled: !canMutate, hint: noPerm, danger: true });
    }
    return list;
  };

  const drawerRow = drawerId ? rows.find((r) => r.clientId === drawerId) ?? null : null;

  return (
    <Page>
      <PageHeader
        title="AutoPay"
        description="Client card-on-file payment plans, including plans imported from Valant."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void load()}
              disabled={loading}
              icon={<RefreshCw className={loading ? 'animate-spin' : ''} />}
            >
              Refresh
            </Button>
            <a href="/api/billing/autopay/export" className={buttonClasses({ variant: 'secondary' })}>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
            {canMutate ? (
              <Button onClick={() => setEnrollOpen(true)} disabled={!data || data.schemaReady === false} icon={<Plus />}>
                Enroll client
              </Button>
            ) : null}
          </>
        }
      />

      <PracticePlanBanner />

      <AutopaySettingsPanel status={payStatus} onChanged={() => void loadStatus()} />
      <p className="text-xs text-slate-500">
        Plan dates below are what each imported plan says; AutoPay charges run after visits and after insurance processes a claim,
        not on plan dates. Valant plans need their card set up again in Altrixs before anything can be charged.
      </p>

      {data?.schemaReady === false ? (
        <Alert tone="warning">The AutoPay table is not on this database yet. Apply the pending migration, then refresh.</Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      <StatGrid columns={4}>
        <Kpi
          label="Active enrollments"
          value={data ? String(kpis.active) : '—'}
          helper={data ? (kpis.activeNeedCard ? `${kpis.activeNeedCard} without a card` : 'All have a card') : undefined}
        />
        <Kpi
          label="Next 7 days"
          value={data ? `${kpis.next7Count} · ${formatCents(kpis.next7Cents)}` : '—'}
          helper="Plan dates, not scheduled charges"
        />
        <Kpi
          label="Needs attention"
          value={data ? String(kpis.attention) : '—'}
          helper="Expired card, past due or declined"
          tone={kpis.attention > 0 ? 'warn' : undefined}
        />
        <Kpi
          label="Enrolled with balance due"
          value={data ? String(kpis.withBalance) : '—'}
          helper={data ? `${formatCents(kpis.withBalanceCents)} on the ledger` : undefined}
        />
      </StatGrid>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            variant="pill"
            label="Filter enrollments"
            controlsPanels={false}
            value={tab}
            onChange={setTab}
            items={TABS.map((t) => ({
              key: t,
              label: TAB_LABEL[t],
              count: counts[t] ?? 0,
              countTone: t === 'attention' ? ('attention' as const) : ('neutral' as const),
            }))}
          />
          <label className="sr-only" htmlFor="autopay-search">
            Search enrollments
          </label>
          <input
            id="autopay-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or MRN"
            className={cx(inputClasses, 'h-10 w-full py-1.5 lg:h-9 lg:w-64 lg:shrink-0')}
          />
        </div>

        {loading && !data ? (
          <LoadingState label="Loading AutoPay…" />
        ) : loadError ? (
          <ErrorState description={loadError} onRetry={() => void load()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              enrolled.length === 0
                ? 'No clients are enrolled in AutoPay yet.'
                : search
                  ? 'No enrollments match your search.'
                  : `No enrollments in “${TAB_LABEL[tab]}”.`
            }
          />
        ) : (
          <div className="clinic-scroll-x">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className={cx('px-4 py-2.5', STICKY_FIRST_TH)}>Client</th>
                  <th scope="col" className="px-4 py-2.5">Plan</th>
                  <th scope="col" className="px-4 py-2.5">Next charge ({zone})</th>
                  <th scope="col" className="px-4 py-2.5">Card</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Balance</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5">Source</th>
                  <th scope="col" className={cx('px-4 py-2.5 text-right', STICKY_ACTIONS_TH)}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((row) => {
                  const d = derived.get(row.clientId)!;
                  const next = row.plan?.nextChargeAt;
                  const balance = row.balanceCents;
                  return (
                    <tr key={row.clientId} className={`group align-top hover:bg-slate-50 ${busyId === row.clientId ? 'opacity-60' : ''}`}>
                      <td className={cx('px-4 py-3', STICKY_FIRST_TD)}>
                        <button
                          type="button"
                          onClick={() => setDrawerId(row.clientId)}
                          className={cx('rounded text-left font-semibold text-slate-900 hover:text-blue-700 hover:underline', FOCUS_RING)}
                        >
                          {row.clientName}
                        </button>
                        <div className="mt-0.5 text-xs text-slate-500">
                          <Link href={`/dashboard/clients/${row.clientId}`} className={cx('rounded tabular-nums hover:text-blue-700 hover:underline', FOCUS_RING)}>
                            {row.mrn ?? 'Open chart'}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{planAmountLabel(row)}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{planFrequencyLabel(row)}</div>
                      </td>
                      <td className="px-4 py-3">
                        {next && !d.ended ? (
                          <>
                            <div className="whitespace-nowrap text-slate-800">{formatPracticeDate(next, timeZone, DATE_OPTS)}</div>
                            <div className="mt-0.5 text-xs tabular-nums text-slate-500">{formatCents(chargeAmountCents(row))}</div>
                          </>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <CardCell card={d.card} testToken={row.card?.testToken} />
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${balance != null && balance < 0 ? 'text-emerald-700' : 'text-slate-800'}`}>
                        {formatBalance(balance)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip status={d.status} />
                        {row.plan?.statusFlag ? <div className="mt-1 text-xs text-slate-500">Valant: {row.plan.statusFlag}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <SourceChip source={sourceLabel(row)} />
                      </td>
                      <td className={cx('px-4 py-3 text-right', STICKY_ACTIONS_TD)}>
                        {busyId === row.clientId ? (
                          <Loader2 size={16} className="ml-auto animate-spin text-slate-400" aria-label="Working" />
                        ) : (
                          <RowActionsMenu label={`Actions for ${row.clientName}`} actions={actionsFor(row)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && visible.length > 0 ? (
          <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            {visible.length} of {enrolled.length} enrollments · dates in practice time ({zone})
          </div>
        ) : null}
      </Card>

      <AutopayChargesPanel timeZone={timeZone} reloadKey={chargesKey} />

      {cardFor ? (
        <CardSetupDialog
          clientId={cardFor.clientId}
          clientName={cardFor.clientName}
          onClose={() => setCardFor(null)}
          onSaved={() => {
            void load();
            setChargesKey((k) => k + 1);
          }}
        />
      ) : null}
      {drawerRow ? (
        <AutopayDrawer row={drawerRow} derived={derived.get(drawerRow.clientId)!} timeZone={timeZone} onClose={closeDrawer} />
      ) : null}
      {enrollOpen ? (
        <EnrollClientDialog candidates={candidates} busy={busyId !== null} onEnroll={(r) => void enroll(r)} onClose={closeEnroll} />
      ) : null}
    </Page>
  );
}
