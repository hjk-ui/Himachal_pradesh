'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { MedicalBillingSummary } from '@/lib/medical/billingSummary';
import {
  Card, CptUsageTable, DefinitionsPanel, Kpi, money, PayerMixTable, RangeControls, shortDate,
  SourceHeader, SourceTag, TrendChart, ValantKpiGrid, type RangeValue,
} from './OverviewSections';

const MEDICAL_DEFINITIONS = [
  { term: 'Primary care (Valant)', text: 'Valant rows whose Transaction Journal facility is Family Practice. Primary care is identified by facility only, never by CPT code (psychiatry also bills E/M 99212–99215).' },
  { term: 'Non-denied claim share', text: 'Altrixs medical charges not in Denied status ÷ all charges. Not a first-pass clean claim rate.' },
  { term: 'Days in A/R', text: 'Open payer A/R (Submitted or Denied charges) ÷ average daily charges over the last 90 days of service.' },
];

function rangeQuery(r: RangeValue): string {
  const q = new URLSearchParams();
  if (r.preset === 'custom') {
    q.set('from', r.from);
    q.set('to', r.to);
  } else q.set('preset', r.preset);
  return q.toString();
}

/** Medical billing summary: Valant Family Practice history (imported) and Altrixs MedicalCharge (live). */
export function MedicalBillingSummaryPanel({ refreshKey }: { refreshKey?: unknown }) {
  const [range, setRange] = useState<RangeValue>({ preset: 'mtd', from: '', to: '' });
  const [data, setData] = useState<MedicalBillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Practice-wide totals are billing / Office Manager only; providers get a 403 and no panel
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiJson<{ success: true; summary: MedicalBillingSummary }>(`/api/medical/billing/summary?${rangeQuery(range)}`);
      setData(res.summary);
      setError(null);
    } catch (err) {
      if ((err as { status?: number })?.status === 403) {
        setForbidden(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load the billing summary');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const v = data?.valant ?? null;
  const a = data?.altrixs;
  const rangeLabel = data ? `${shortDate(data.range.fromDate)} – ${shortDate(data.range.toDate)}` : '';
  const asOf = v?.asOf.importedAt ?? null;

  if (forbidden) return null;

  return (
    <div className="space-y-4 mb-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <RangeControls value={range} onChange={setRange} />
        <p className="text-[11px] text-slate-500">{data ? `Dates of service ${rangeLabel}.` : ''} Valant (imported) and Altrixs (live) are shown separately and never added together.</p>
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle size={14} /> {error}
        </p>
      )}
      {loading && !data && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading billing summary…</p>}

      {data && a && (
        <>
          <div className={`grid lg:grid-cols-2 gap-4 ${loading ? 'opacity-60' : ''}`}>
            <Card title="Primary-care revenue (Valant)" right={<SourceHeader source="valant" asOf={asOf} note="Family Practice facility" />}>
              {data.valantAccess === 'hidden' ? (
                <p className="text-sm text-slate-500">Valant revenue totals are shown to billing staff, leadership and the primary care team.</p>
              ) : data.emptyNote ? (
                <p className="text-sm text-slate-600">
                  {data.emptyNote}{' '}
                  <Link href="/dashboard/admin/migration" className="text-purple-700 hover:underline">Admin › Data import</Link>
                </p>
              ) : v ? (
                <>
                  <ValantKpiGrid kpis={v.kpis} rangeLabel={rangeLabel} />
                  <SourceTag text={`${data.valantAccess === 'caseload' ? 'Your patients only. ' : ''}Family Practice rows cover ${shortDate(v.asOf.earliestServiceDate)} – ${shortDate(v.asOf.latestServiceDate)}. Reference only.`} />
                </>
              ) : null}
            </Card>
            <Card title="Medical charges (Altrixs)" right={<SourceHeader source="altrixs" />}>
              {a.emptyNote && <p className="mb-3 rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-800">{a.emptyNote}</p>}
              <div className="grid grid-cols-2 gap-3">
                <Kpi label="Charges in range" value={money(a.inRange.billedCents)} sub={`${a.inRange.count} charges · ${a.inRange.paidCount} paid · ${a.inRange.deniedCount} denied`} />
                <Kpi label="All charges on file" value={money(a.billedCents)} sub={`${a.total} charges`} />
                <Kpi label="Non-denied claim share" value={a.nonDeniedShare == null ? 'Not enough data' : `${(a.nonDeniedShare * 100).toFixed(1)}%`} sub="Not a first-pass clean claim rate" />
                <Kpi label="Days in A/R" value={a.daysInAr == null ? 'Not enough data' : `${a.daysInAr.toFixed(1)} days`} sub="Open payer A/R ÷ avg daily charges (90 days)" />
                <Kpi label="Active denials" value={String(a.byStatus.Denied ?? 0)} />
                <Kpi label="Ready / submitted" value={`${a.byStatus.Ready ?? 0} / ${a.byStatus.Submitted ?? 0}`} />
              </div>
            </Card>
          </div>

          {v && (
            <>
              <Card title="Primary care — charges vs payments, last 12 months" right={<SourceHeader source="valant" asOf={asOf} note="by month of service" />}>
                <TrendChart points={v.trend} pick={(p) => [p.chargesCents, p.paymentsCents]} />
              </Card>
              <div className="grid lg:grid-cols-2 gap-4">
                <Card title="Primary-care payer mix" right={<SourceHeader source="valant" asOf={asOf} />}>
                  <PayerMixTable mix={v.payerMix} />
                </Card>
                <Card title="Primary-care CPT usage" right={<SourceHeader source="valant" asOf={asOf} />}>
                  <CptUsageTable rows={v.cpt} />
                </Card>
              </div>
            </>
          )}
          <DefinitionsPanel extra={MEDICAL_DEFINITIONS} />
        </>
      )}
    </div>
  );
}
