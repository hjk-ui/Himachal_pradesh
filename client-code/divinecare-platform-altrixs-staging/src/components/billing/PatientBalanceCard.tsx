'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { formatCents } from '@/lib/migration/valantReportCommon';
import type { PatientBalanceBreakdown } from '@/lib/billing/patientLedgerMath';
import type { LedgerEntryRecord } from '@/features/billing/ledgerApi';

/**
 * Client chart (Insurance tab): the patient's Altrixs ledger balance (patientBalance) and how it is made up:
 * Valant opening balance as of <date>, Valant prepayment credit, Altrixs claims and patient payments.
 * Renders nothing when the role cannot read the ledger.
 */

type Data = { balance: PatientBalanceBreakdown; entries: LedgerEntryRecord[]; schemaReady: boolean };

function Line({ label, cents, sign = 1, hint }: { label: string; cents: number; sign?: 1 | -1; hint?: string }) {
  const v = sign * cents;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-slate-600">
        {label}
        {hint ? <span className="ml-1 text-[11px] text-slate-400">{hint}</span> : null}
      </dt>
      <dd className={`text-sm font-semibold tabular-nums ${v < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>{formatCents(v)}</dd>
    </div>
  );
}

export function PatientBalanceCard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [history, setHistory] = useState(false);

  useEffect(() => {
    let live = true;
    apiJson<Data>(`/api/billing/patient-balance/${encodeURIComponent(clientId)}`)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [clientId]);

  if (!data) return null;
  const b = data.balance;
  const superseded = data.entries.filter((e) => e.supersededAt);
  return (
    <div className="clinic-card p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="clinic-section-title">Patient balance (Altrixs ledger)</h3>
        <span className={`text-lg font-bold tabular-nums ${b.balanceCents < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
          {b.balanceCents < 0 ? `${formatCents(-b.balanceCents)} credit` : formatCents(b.balanceCents)}
        </span>
      </div>
      <dl className="divide-y divide-slate-100">
        {b.openingBalanceCents || b.openingBalanceAsOf ? (
          <Line label="Valant opening balance" hint={b.openingBalanceAsOf ? `as of ${b.openingBalanceAsOf}` : undefined} cents={b.openingBalanceCents} />
        ) : null}
        {b.prepaymentCreditCents || b.prepaymentAsOf ? (
          <Line label="Valant prepayment credit" hint={b.prepaymentAsOf ? `through ${b.prepaymentAsOf}` : undefined} cents={b.prepaymentCreditCents} />
        ) : null}
        {b.adjustmentsCents ? <Line label="Adjustments" cents={b.adjustmentsCents} /> : null}
        <Line label="Altrixs claims (patient responsibility)" hint={b.claimCount ? `${b.claimCount} claim(s)` : undefined} cents={b.claimsPatientCents} />
        <Line label="Patient payments" hint={b.paymentCount ? `${b.paymentCount} payment(s)` : undefined} cents={b.patientPaymentsCents} sign={-1} />
      </dl>
      <p className="mt-2 text-[11px] text-slate-500">
        Insurance balances from Valant are not posted here; they stay in Valant until run-out.
      </p>
      {superseded.length ? (
        <div className="mt-2">
          <button type="button" onClick={() => setHistory((v) => !v)} className="text-xs font-bold text-[#5C2D91] hover:underline" aria-expanded={history}>
            {history ? 'Hide' : 'Show'} replaced postings ({superseded.length})
          </button>
          {history ? (
            <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
              {superseded.map((e) => (
                <li key={e.id}>
                  {e.label} {formatCents(e.amountCents)} as of {e.asOf} · posted {e.postedAt.slice(0, 10)} · {e.supersededById ? 'replaced' : 'unposted'} {e.supersededAt?.slice(0, 10)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
