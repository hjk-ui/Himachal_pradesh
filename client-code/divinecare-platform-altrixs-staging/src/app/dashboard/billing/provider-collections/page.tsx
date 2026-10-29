'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Info, Printer, RefreshCw } from 'lucide-react';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  CardBody,
  cardClasses,
  cx,
  EmptyState,
  FOCUS_RING,
  FormField,
  inputClasses,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  Tabs,
} from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import {
  formatMoney,
  formatPct,
  SECTION_LABEL,
  type CollectionsReport,
  type SectionKey,
} from '@/lib/billing/providerCollections';

/**
 * Billing → Provider Collections. Valant's "Payments, Refunds and Adjustments" report (by provider), rebuilt
 * from the imported Valant transactions. Reference only: nothing here posts to the Altrixs ledger.
 */

type CollectionsResponse = CollectionsReport & {
  success: boolean;
  organizationName: string | null;
  from: string | null;
  to: string | null;
  dateBasisNote: string;
  undatedRows: number;
};

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Kpi({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <StatCard
      label={strong ? <span className="font-semibold text-slate-900">{label}</span> : label}
      value={<span className={cents < 0 ? 'text-rose-700' : undefined}>{formatMoney(cents)}</span>}
    />
  );
}

export default function ProviderCollectionsPage() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => `${today.getFullYear()}-01-01`);
  const [to, setTo] = useState(() => localIso(today));
  const [provider, setProvider] = useState('');
  const [tab, setTab] = useState<SectionKey | 'all'>('all');
  const [data, setData] = useState<CollectionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (provider) q.set('provider', provider);
    return q;
  }, [from, to, provider]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<CollectionsResponse & { error?: string }>(`/api/billing/provider-collections?${query.toString()}`);
      if (!res.success) throw new Error(res.error || 'Could not load provider collections');
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load provider collections');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const csvHref = useMemo(() => {
    const q = new URLSearchParams(query);
    if (tab !== 'all') q.set('section', tab);
    q.set('format', 'csv');
    return `/api/billing/provider-collections?${q.toString()}`;
  }, [query, tab]);

  const sections = (data?.sections ?? []).filter((s) => tab === 'all' || s.key === tab);
  const visibleTabs = (data?.sections ?? []).filter((s) => s.key !== 'other' || s.providers.length > 0);
  const sm = data?.summary;

  return (
    <Page className="print:max-w-none">
      <PageHeader
        title="Provider Collections"
        description={
          <>
            Payments, refunds and adjustments by provider, from imported Valant transactions
            {data?.organizationName ? <> · Facility: <span className="font-semibold text-slate-700">{data.organizationName}</span></> : null}
            {data?.from || data?.to ? <> · {data?.from ?? 'any'} to {data?.to ?? 'any'}</> : null}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>
              Print
            </Button>
            <a href={csvHref} className={buttonClasses({ variant: 'primary' })}>
              <Download size={16} aria-hidden /> Export CSV
            </a>
          </div>
        }
      />

      <Alert tone="brand" icon={<Info />}>
        {data?.dateBasisNote ?? "Grouped by date of service; Valant's report uses posted date, so totals can differ slightly for payments posted this year on prior-year visits"}.
        Amounts are shown positive as Valant prints them; a negative amount nets the other way from its section. Charges and
        no-show / cancel fees are not part of this report. Altrixs payments are not included (they have no provider link).
      </Alert>

      <Card className="print:hidden">
        <CardBody className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-[auto_auto_minmax(12rem,1fr)_auto]">
          <FormField label="From (date of service)">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClasses} />
          </FormField>
          <FormField label="To">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClasses} />
          </FormField>
          <FormField label="Provider">
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClasses}>
              <option value="">All providers</option>
              {(data?.providers ?? []).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                  {p.matchedStaff && p.valantCodes.length ? ` (${p.valantCodes.join(', ')})` : ''}
                </option>
              ))}
            </select>
          </FormField>
          <Button variant="secondary" icon={<RefreshCw />} loading={loading} onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </CardBody>
      </Card>

      {error ? (
<Alert tone="danger">{error}</Alert>
      ) : null}

      {data && data.unmappedCodes.length ? (
        <Alert tone="warning" icon={<AlertTriangle />}>
          <span className="font-semibold">Codes not in Valant&apos;s report map</span> (shown under Other, stored sign):{' '}
          {data.unmappedCodes.map((u) => `${u.code} (${u.count}, ${formatMoney(u.cents)})`).join('; ')}
        </Alert>
      ) : null}
      {data && data.undatedRows > 0 ? (
        <Alert tone="neutral">
          {data.undatedRows} transaction{data.undatedRows === 1 ? '' : 's'} with no date of service are outside any date range.
        </Alert>
      ) : null}

      {sm ? (
        <StatGrid columns={5}>
          <Kpi label="Payments" cents={sm.paymentsCents} />
          <Kpi label="Refunds" cents={sm.refundsCents} />
          <Kpi label="Credit Adjustments" cents={sm.creditAdjustmentsCents} />
          <Kpi label="Charge Adjustments" cents={sm.chargeAdjustmentsCents} />
          <Kpi label="Net collections" cents={sm.netCollectionsCents} strong />
        </StatGrid>
      ) : null}

      {data ? (
        <Tabs
          className="print:hidden"
          label="Report section"
          controlsPanels={false}
          value={tab}
          onChange={(key) => setTab(key)}
          items={[{ key: 'all' as const, label: 'All sections' }, ...visibleTabs.map((s) => ({ key: s.key, label: SECTION_LABEL[s.key] }))]}
        />
      ) : loading ? (
        <Card>
          <LoadingState />
        </Card>
      ) : null}

      {sections
        .filter((s) => s.key !== 'other' || s.providers.length > 0)
        .map((s) => {
          const isCollapsed = collapsed[s.key];
          return (
            <section key={s.key} className={cx(cardClasses, 'print:break-inside-avoid')}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [s.key]: !c[s.key] }))}
                className={cx('flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-5 py-4 text-left hover:bg-slate-50', FOCUS_RING)}
                aria-expanded={!isCollapsed}
              >
                <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
                  {isCollapsed ? <ChevronRight size={16} aria-hidden className="text-slate-500 print:hidden" /> : <ChevronDown size={16} aria-hidden className="text-slate-500 print:hidden" />}
                  {s.label}
                  <span className="text-xs font-medium text-slate-500">
                    {s.providers.length} provider{s.providers.length === 1 ? '' : 's'} · {s.count} transaction{s.count === 1 ? '' : 's'}
                  </span>
                </span>
                <span className={`text-base font-semibold tabular-nums ${s.cents < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{formatMoney(s.cents)}</span>
              </button>
              {!isCollapsed ? (
                <div className="space-y-3 border-t border-slate-200 px-5 py-4">
                  {s.providers.length === 0 ? (
                    <EmptyState compact title={`No ${s.label.toLowerCase()} in this range.`} />
                  ) : (
                    s.providers.map((p) => (
                      <div key={p.key} className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200 print:break-inside-avoid">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 bg-slate-50 px-3 py-2">
                          <span className="text-sm font-semibold text-slate-800">
                            {p.label}
                            {p.matchedStaff && p.valantCodes.length ? <span className="ml-2 text-xs font-medium text-slate-500">Valant: {p.valantCodes.join(', ')}</span> : null}
                          </span>
                        </div>
                        <table className="w-full min-w-[35rem] text-xs">
                          <thead className="bg-slate-50">
                            <tr className="text-left font-semibold text-slate-600">
                              <th scope="col" className="px-3 py-2">Code</th>
                              <th scope="col" className="px-3 py-2">Description</th>
                              <th scope="col" className="px-3 py-2 text-right">Transactions</th>
                              <th scope="col" className="px-3 py-2 text-right">Amount</th>
                              <th scope="col" className="px-3 py-2 text-right">% of section</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.rows.map((r) => (
                              <tr key={r.code} className="border-t border-slate-100">
                                <td className="px-3 py-2 font-semibold text-slate-700">{r.code}</td>
                                <td className="px-3 py-2 text-slate-600">{r.description}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.count}</td>
                                <td className={`px-3 py-2 text-right tabular-nums ${r.cents < 0 ? 'text-rose-700' : 'text-slate-800'}`}>{formatMoney(r.cents)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatPct(r.pctOfSection)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                              <td className="px-3 py-2 text-slate-700" colSpan={2}>{p.label} subtotal</td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-600">{p.count}</td>
                              <td className={`px-3 py-2 text-right tabular-nums ${p.cents < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{formatMoney(p.cents)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatPct(p.pctOfSection)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ))
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold text-slate-900">
                    <span>{s.label} total</span>
                    <span className="tabular-nums">{formatMoney(s.cents)}</span>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}

      {data && data.excluded.chargeRows + data.excluded.feeRows > 0 ? (
        <p className="text-xs text-slate-500">
          Not in this report: {data.excluded.chargeRows} charge transactions ({formatMoney(data.excluded.chargeCents)}) and {data.excluded.feeRows} fee / admin
          transactions ({formatMoney(data.excluded.feeCents)}) in the same date range (all providers).
        </p>
      ) : null}
    </Page>
  );
}
