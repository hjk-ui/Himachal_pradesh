'use client';

import { useEffect, useState } from 'react';
import { formatCopayMaximum } from '@/lib/migration/valantCopays';
import { AlertTriangle, X } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { formatCents } from '@/lib/migration/valantReportCommon';
import { OVER_120_NOTE } from '@/lib/billing/valantAgingDisplay';
import { ValantTransactionsTable } from '@/components/billing/ValantTransactionsTable';

/**
 * Client chart (Insurance tab): "Valant (reference)" balances card and "Copays (from Valant)".
 * Renders nothing when the patient has no Valant reference data or the role cannot see it.
 */

/** From the server presenter: displayBucketsCents = shown, valantBucketsCents = Valant's original buckets */
type Presented = { displayBucketsCents: number[]; valantBucketsCents: number[]; totalCents: number; shownAsOver120: boolean };
type Party = Presented & { party: string; payerName: string | null; lastBilledAt: string | null };
type CardData = {
  note: string;
  valantLimitLabel: string;
  reference: {
    labels: { labels: string[]; confirmed: boolean; displayAllOver120?: boolean };
    transactionCount: number;
    aging: (Presented & { asOf: string | null; bucketsMatchTotal: boolean }) | null;
    prepayment: {
      transactions: number; periodStart: string | null; periodEnd: string | null; netCents: number;
      remainingCents: number | null; incomplete: boolean; note: string | null;
    } | null;
    combined: (Presented & { asOf: string | null; parties: Party[] }) | null;
  } | null;
  copayRules: {
    id: string; payerName: string; providerType: string | null; cptRule: string | null; amountCents: number;
    valantLimitRaw: string | null; valantLimitCents?: number | null; source: string;
  }[] | null;
};

const PARTY: Record<string, string> = { patient: 'Patient', primary: 'Primary', secondary: 'Secondary', other: 'Other' };

export function ValantReferenceCard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<CardData | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    let live = true;
    apiJson<CardData>(`/api/billing/valant-balances/client/${encodeURIComponent(clientId)}`)
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, [clientId]);

  if (!data) return null;
  const ref = data.reference;
  const hasRef = Boolean(ref && (ref.aging || ref.prepayment || ref.combined || ref.transactionCount));
  const rules = data.copayRules ?? [];
  if (!hasRef && !rules.length) return null;
  const labels = ref?.labels.labels ?? ['1', '2', '3', '4', '5'];

  return (
    <>
      {hasRef && ref ? (
        <div className="clinic-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="clinic-section-title">Valant (reference)</h3>
            <span className="rounded-full bg-purple-50 px-2.5 py-0.5 text-[11px] font-bold text-[#5C2D91]">Reference copy — what is posted shows in Patient balance</span>
          </div>
          {!ref.labels.confirmed && (ref.aging || ref.combined) ? (
            <p className="mb-2 flex items-center gap-1 text-[11px] text-amber-800">
              <AlertTriangle size={12} /> Aging headings are inferred, not yet confirmed in Valant.
            </p>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
            {ref.aging ? (
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium text-slate-500">Patient balance (Valant aging, as of {ref.aging.asOf})</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{formatCents(ref.aging.totalCents)}</p>
                <dl className="mt-1 grid grid-cols-3 gap-1 text-[11px] sm:grid-cols-5">
                  {ref.aging.displayBucketsCents.map((c, i) => (
                    <div key={i}>
                      <dt className="text-slate-500">{labels[i]}</dt>
                      <dd className="font-semibold tabular-nums">{formatCents(c)}</dd>
                    </div>
                  ))}
                </dl>
                {ref.aging.shownAsOver120 ? (
                  <div className="mt-1 text-[11px] text-slate-500">
                    {OVER_120_NOTE}{' '}
                    <button type="button" onClick={() => setShowOriginal((v) => !v)} className="font-bold text-[#5C2D91] hover:underline" aria-expanded={showOriginal}>
                      {showOriginal ? 'Hide' : 'Show'}
                    </button>
                    {showOriginal ? (
                      <dl className="mt-1 grid grid-cols-3 gap-1 sm:grid-cols-5">
                        {ref.aging.valantBucketsCents.map((c, i) => (
                          <div key={i}>
                            <dt>{labels[i]}</dt>
                            <dd className="tabular-nums">{formatCents(c)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {ref.combined ? (
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium text-slate-500">Combined aging (as of {ref.combined.asOf})</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{formatCents(ref.combined.totalCents)}</p>
                <ul className="mt-1 space-y-0.5 text-[11px]">
                  {ref.combined.parties.map((p, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>
                        {PARTY[p.party] ?? p.party}
                        {p.payerName ? `: ${p.payerName}` : ''}
                        {p.lastBilledAt ? <span className="text-slate-500"> · last billed {p.lastBilledAt}</span> : null}
                      </span>
                      <span className="font-semibold tabular-nums">{formatCents(p.totalCents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {ref.prepayment ? (
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium text-slate-500">
                  Prepayment remaining (Valant, {ref.prepayment.periodStart} to {ref.prepayment.periodEnd})
                </p>
                {ref.prepayment.incomplete ? (
                  <p className="mt-1 text-sm font-semibold text-amber-800">{ref.prepayment.note}</p>
                ) : (
                  <p className="mt-1 text-lg font-bold text-slate-900">{formatCents(ref.prepayment.remainingCents)}</p>
                )}
                <p className="text-[11px] text-slate-500">{ref.prepayment.transactions} transactions</p>
              </div>
            ) : null}
          </div>
          {ref.transactionCount ? (
            <button type="button" onClick={() => setDrawer(true)} className="mt-3 text-xs font-bold text-[#5C2D91] hover:underline">
              Valant transaction history ({ref.transactionCount.toLocaleString()})
            </button>
          ) : null}
        </div>
      ) : null}

      {rules.length ? (
        <div className="clinic-card p-5">
          <h3 className="clinic-section-title mb-1">Copays (from Valant)</h3>
          <p className="mb-3 text-[11px] text-slate-500">Copay settings by payer, provider type and CPT. Blank means “all”. The most specific rule applies to a visit.</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 text-left">Payer</th>
                  <th className="py-1 text-left">Provider type</th>
                  <th className="py-1 text-left">CPT</th>
                  <th className="py-1 text-right">Copay</th>
                  <th className="py-1 text-right">{data.valantLimitLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1">{r.payerName}{r.source !== 'valant' ? <span className="ml-1 text-[10px] text-teal-700">Altrixs</span> : null}</td>
                    <td className="py-1">{r.providerType ?? 'All'}</td>
                    <td className="py-1">{r.cptRule ?? 'All'}</td>
                    <td className="py-1 text-right font-semibold tabular-nums">{formatCents(r.amountCents)}</td>
                    <td className="py-1 text-right text-slate-500">{formatCopayMaximum(r.valantLimitRaw, r.valantLimitCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {drawer ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDrawer(false)}>
          <div className="h-full w-full max-w-5xl overflow-y-auto bg-white p-4 shadow-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold text-slate-900">Valant transaction history</p>
                <p className="text-xs text-[#5C2D91]">Reference only — not posted to the Altrixs ledger</p>
              </div>
              <button type="button" onClick={() => setDrawer(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <ValantTransactionsTable clientId={clientId} />
          </div>
        </div>
      ) : null}
    </>
  );
}
