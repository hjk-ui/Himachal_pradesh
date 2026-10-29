'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { fetchPayments, type LedgerEntryRecord, type PaymentRecord } from '@/features/billing/ledgerApi';
import { Alert, Card, CardHeader, EmptyState, LoadingState, StatusBadge } from '@/components/ui';

/**
 * Payments page: patient ledger history. Patient payments from the ledger plus the active ledger entries
 * posted from Valant ("Valant opening balance" / "Valant prepayment credit"), newest first.
 */

type Row =
  | { type: 'payment'; at: string; p: PaymentRecord }
  | { type: 'entry'; at: string; e: LedgerEntryRecord };

const money = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString();

export function PatientLedgerHistory() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [entries, setEntries] = useState<LedgerEntryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetchPayments()
      .then((d) => {
        if (!live) return;
        setPayments(d.payments);
        setEntries(d.ledgerEntries ?? []);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Could not load the ledger'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo<Row[]>(
    () =>
      [
        ...payments.map((p): Row => ({ type: 'payment', at: p.paidAt, p })),
        ...entries.map((e): Row => ({ type: 'entry', at: e.postedAt, e })),
      ].sort((a, b) => b.at.localeCompare(a.at)),
    [payments, entries]
  );

  return (
    <Card>
      <CardHeader
        icon={<BookOpen />}
        title="Patient ledger history"
        description="Payments recorded in Altrixs and balances posted from Valant"
      />
      {error ? <Alert tone="danger" className="m-5 mb-0">{error}</Alert> : null}
      <div className="clinic-scroll-x overflow-x-auto">
        {loading ? (
          <LoadingState label="Loading ledger…" />
        ) : rows.length === 0 ? (
          <EmptyState compact title="No ledger activity yet" />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3">Date</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Patient</th>
                <th scope="col" className="px-4 py-3 text-right">Amount</th>
                <th scope="col" className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rows.slice(0, 300).map((r) =>
                r.type === 'payment' ? (
                  <tr key={`p-${r.p.id}`}>
                    <td className="px-4 py-2.5">{day(r.p.paidAt)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge size="sm" tone={r.p.stub ? 'neutral' : r.p.method === 'INSURANCE' ? 'brand' : 'success'}>
                        {r.p.stub ? 'STUB (not charged)' : r.p.method === 'INSURANCE' ? 'Insurance payment' : `Payment · ${r.p.method}`}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{r.p.clientName}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-700">-{money(r.p.amountCents)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.p.note || '—'}</td>
                  </tr>
                ) : (
                  <tr key={`e-${r.e.id}`} className="bg-amber-50/40">
                    <td className="px-4 py-2.5">{day(r.e.postedAt)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge size="sm" tone="warning">{r.e.label}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{r.e.clientName}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${r.e.amountCents < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                      {r.e.amountCents < 0 ? `${money(r.e.amountCents)} credit` : money(r.e.amountCents)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{r.e.asOf ? `As of ${r.e.asOf}` : ''}{r.e.note ? ` · ${r.e.note}` : ''}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
