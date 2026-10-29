'use client';

import { useEffect, useState } from 'react';

type PaymentRow = { id: string; clientName: string; amountCents: number; method: string; claimId: string | null };
type LedgerRow = { id: string; kind: string; amountCents: number; asOf: string };

export function PatientLedgerList() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  useEffect(() => {
    fetch('/api/billing/payments', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data?.success) return;
        setPayments(data.payments || []);
        setLedger(data.ledgerEntries || []);
      })
      .catch(() => undefined);
  }, []);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">Patient payments</h2>
      <ul className="mt-2 divide-y text-sm">
        {payments.length === 0 ? <li className="py-2 text-slate-500">No patient payments on file.</li> : payments.slice(0, 12).map((row) => (
          <li key={row.id} className="flex justify-between py-2">
            <span>{row.clientName} · {row.method}{row.claimId ? ' · claim' : ''}</span>
            <span>${(row.amountCents / 100).toFixed(2)}</span>
          </li>
        ))}
      </ul>
      {ledger.length ? (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Old-system ledger</h3>
          <ul className="mt-1 text-sm text-slate-700">
            {ledger.slice(0, 8).map((row) => (
              <li key={row.id}>{row.kind} · ${(row.amountCents / 100).toFixed(2)} · {row.asOf.slice(0, 10)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
