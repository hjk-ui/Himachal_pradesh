'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { Alert, LoadingState } from '@/components/ui';
import type { BillingOverview } from '@/lib/billing/overview';
import {
  Card, CptUsageTable, DefinitionsPanel, downloadCsv, HALF_CARD_KPI_GRID, Kpi, money, PayerMixTable, RangeControls, shortDate,
  SourceHeader, SourceTag, TrendChart, ValantKpiGrid, type RangeValue,
} from './OverviewSections';

const LEDGER_KIND_LABEL: Record<string, string> = {
  opening_balance: 'Valant opening balances',
  prepayment_credit: 'Valant prepayment credits',
  manual_adjustment: 'Manual adjustments',
};

function rangeQuery(r: RangeValue, facility: string | null): string {
  const q = new URLSearchParams();
  if (r.preset === 'custom') {
    q.set('from', r.from);
    q.set('to', r.to);
  } else {
    q.set('preset', r.preset);
  }
  if (facility) q.set('facility', facility);
  return q.toString();
}

function QueueLink({ label, count, href, note }: { label: string; count: number | null; href: string; note?: string }) {
  return (
    <Link href={href} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:border-blue-300 hover:bg-slate-50">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="stat-number text-lg font-semibold text-slate-900">{count == null ? '—' : count.toLocaleString()}</span>
        <ArrowRight size={16} className="text-slate-400" aria-hidden />
      </div>
    </Link>
  );
}

/** Billing overview: Valant (imported) and Altrixs (live), side by side and never summed. */
export function BillingOverviewPanel() {
  const [range, setRange] = useState<RangeValue>({ preset: 'mtd', from: '', to: '' });
  const [facility, setFacility] = useState<string | null>(null);
  const [data, setData] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiJson<{ success: true; overview: BillingOverview }>(`/api/billing/overview?${rangeQuery(range, facility)}`);
      setData(res.overview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the billing overview');
    } finally {
      setLoading(false);
    }
  }, [range, facility]);

  useEffect(() => {
    void load();
  }, [load]);

  const csv = (table: 'trend' | 'payers' | 'cpt') => {
    const q = `${rangeQuery(range, facility)}&format=csv&table=${table}`;
    downloadCsv(`/api/billing/overview?${q}`, `billing-overview-${table}.csv`).catch((err) =>
      setError(err instanceof Error ? err.message : 'Export failed')
    );
  };

  const v = data?.valant;
  const a = data?.altrixs;
  const rangeLabel = data ? `${shortDate(data.range.fromDate)} – ${shortDate(data.range.toDate)}` : '';
  const valantAsOf = v?.asOf.importedAt ?? null;

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <RangeControls
          value={range}
          onChange={setRange}
          facility={v ? { options: v.facility.options, selected: facility, note: v.facility.note, onChange: setFacility } : undefined}
        />
        <p className="text-xs text-slate-500">
          {data ? `Dates of service ${rangeLabel}.` : ''} Valant figures are by date of service; Altrixs claims by created date and payments by paid date.
          {facility && ' The location filter applies to Valant rows only.'}
        </p>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {loading && !data && <LoadingState label="Loading billing overview…" />}

      {data && v && a && (
        <>
          {/* KPIs: two sources side by side */}
          <div className={`grid lg:grid-cols-2 gap-4 ${loading ? 'opacity-60' : ''}`}>
            <Card title="Revenue (Valant)" right={<SourceHeader source="valant" asOf={valantAsOf} />}>
              {!v.hasData ? (
                <p className="text-sm text-gray-500">
                  No Valant transactions imported yet. <Link href="/dashboard/admin/migration" className="text-purple-700 hover:underline">Admin › Data import</Link>
                </p>
              ) : (
                <>
                  <ValantKpiGrid kpis={v.kpis} rangeLabel={rangeLabel} />
                  <SourceTag
                    text={`Imported rows cover dates of service ${shortDate(v.asOf.earliestServiceDate)} – ${shortDate(v.asOf.latestServiceDate)}.${
                      v.undatedRows ? ` ${v.undatedRows.toLocaleString()} rows have no date of service and are not in any range.` : ''
                    } Reference only; never posted to the Altrixs ledger.`}
                  />
                </>
              )}
            </Card>
            <Card title="Claims & payments (Altrixs)" right={<SourceHeader source="altrixs" />}>
              {a.emptyNote && <p className="mb-3 rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-800">{a.emptyNote}</p>}
              <div className={HALF_CARD_KPI_GRID}>
                <Kpi label="Claims submitted" value={a.claims.submitted.toLocaleString()} sub={money(a.claims.billedCents)} />
                <Kpi label="Claims pending" value={a.claims.pending.toLocaleString()} sub="Not yet paid or denied" />
                <Kpi label="Claims paid" value={a.claims.paid.toLocaleString()} sub={money(a.claims.paidCents)} />
                <Kpi label="Claims denied" value={a.claims.denied.toLocaleString()} />
                <Kpi label="Insurance payments" value={a.payments ? money(a.payments.insuranceCents) : '—'} />
                <Kpi label="Patient payments" value={a.payments ? money(a.payments.patientCents) : '—'} />
                <Kpi label="Payments posted" value={a.payments ? a.payments.count.toLocaleString() : '—'} />
                <Kpi label="Statements due" value={a.statements ? a.statements.due.toLocaleString() : '—'} sub={a.statements ? money(a.statements.dueCents) : 'Not available'} />
              </div>
              <SourceTag text={`Claims created ${rangeLabel}; payments by paid date (test stubs excluded). Statements due = open statements with a balance (any date).`} />
            </Card>
          </div>

          {/* Trend */}
          <Card title="Charges vs payments — last 12 months" right={<SourceHeader source="valant" asOf={valantAsOf} note="by month of service" />}>
            {v.hasData ? (
              <TrendChart points={v.trend} pick={(p) => [p.chargesCents, p.paymentsCents]} onCsv={() => csv('trend')} />
            ) : <p className="text-sm text-gray-500">No Valant transactions imported yet.</p>}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <SourceHeader source="altrixs" note={a.trend.length ? 'billed by claim created month; payments by paid month' : undefined} />
              {a.trend.length ? (
                <div className="mt-2">
                  <TrendChart points={a.trend} pick={(p) => [p.billedCents, p.paymentsCents]} seriesLabels={['Billed', 'Payments']} />
                </div>
              ) : (
                <p className="mt-2 text-xs text-gray-500">No Altrixs claims or payments yet — the Altrixs trend starts after go-live.</p>
              )}
            </div>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Payer mix" right={<SourceHeader source="valant" asOf={valantAsOf} />}>
              <PayerMixTable mix={v.payerMix} onCsv={v.hasData ? () => csv('payers') : undefined} />
            </Card>
            <Card title="CPT usage" right={<SourceHeader source="valant" asOf={valantAsOf} />}>
              <CptUsageTable rows={v.cpt} onCsv={v.hasData ? () => csv('cpt') : undefined} feeScheduleHref="/dashboard/billing/fee-schedule" />
            </Card>
          </div>

          {/* A/R snapshot */}
          <Card title="A/R snapshot" right={<SourceHeader source="valant" note="latest aging imports" />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Insurance A/R" value={data.ar.insurance ? money(data.ar.insurance.totalCents) : '—'}
                sub={data.ar.insurance ? `As of ${shortDate(data.ar.insurance.asOf)} · ${data.ar.insurance.rows} payer rows` : 'No insurance aging imported'} />
              <Kpi label="Patient A/R" value={data.ar.patient ? money(data.ar.patient.totalCents) : '—'}
                sub={data.ar.patient ? `As of ${shortDate(data.ar.patient.asOf)} · ${data.ar.patient.rows} patients` : 'No patient aging imported'} />
              <Kpi label="Patient credit balances" value={data.ar.prepaymentCredits ? money(data.ar.prepaymentCredits.creditCents) : '—'}
                sub={data.ar.prepaymentCredits
                  ? `Prepayments ${shortDate(data.ar.prepaymentCredits.periodStart)} – ${shortDate(data.ar.prepaymentCredits.periodEnd)} · ${data.ar.prepaymentCredits.clients} clients${data.ar.prepaymentCredits.excluded ? `, ${data.ar.prepaymentCredits.excluded} incomplete/unmatched not counted` : ''}`
                  : 'No prepayments imported'} />
              <div className="rounded-xl border border-gray-100 bg-white p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Posted to Altrixs ledger</p>
                {data.ar.ledger.kinds.length === 0 ? (
                  <p className="mt-1 text-xs text-gray-500">{data.ar.ledger.schemaReady ? 'Nothing posted yet' : 'Ledger table not on this database'}</p>
                ) : data.ar.ledger.kinds.map((k) => (
                  <p key={k.kind} className="mt-1 text-xs text-gray-700">
                    {LEDGER_KIND_LABEL[k.kind] ?? k.kind}: <span className="font-semibold tabular-nums">{money(k.totalCents)}</span> ({k.entries})
                  </p>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs">
              <Link href="/dashboard/billing/ar-control" className="text-purple-700 hover:underline">A/R Control Center</Link>
              <Link href="/dashboard/billing/valant-balances" className="text-purple-700 hover:underline">Valant Balances</Link>
            </div>
            <SourceTag text="Totals of the latest Valant aging imports, not live balances. Insurance A/R stays in Valant (run-out); patient balances reach the Altrixs ledger only when posted from Valant Balances." />
          </Card>

          {/* Work queues */}
          <Card title="Work queues">
            <div className="grid md:grid-cols-2 gap-3">
              <QueueLink label="Notes signed, not billed" count={data.queues.notesSignedNotBilled} href="/dashboard/billing/claims"
                note="Altrixs signed notes with no Altrixs claim (includes non-billable note types)" />
              <QueueLink label="Open denials" count={data.queues.denialsOpen} href="/dashboard/billing/denials" note="Altrixs claim denials" />
              <QueueLink label="Statements due" count={data.queues.statementsDue} href="/dashboard/billing/statements" note="Altrixs statements with a balance" />
              <QueueLink label="Unmatched Valant rows" count={data.queues.unmatchedValantRows} href="/dashboard/admin/migration"
                note="Imported Valant transactions not matched to a client" />
              <QueueLink label="Authorizations at risk" count={data.queues.authorizationsAtRisk ?? null} href="/dashboard/billing/authorizations?tab=tracking"
                note="Forecast: run out before the end date, expiring within the renewal lead time, or expired" />
            </div>
          </Card>

          <DefinitionsPanel />
        </>
      )}
    </div>
  );
}
