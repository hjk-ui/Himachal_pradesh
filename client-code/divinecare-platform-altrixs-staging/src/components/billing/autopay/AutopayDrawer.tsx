'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { formatCents } from '@/lib/migration/valantReportCommon';
import { formatPracticeDate, formatPracticeDateTime } from '@/lib/time/practiceTime';
import { CardCell, SourceChip, StatusChip } from './AutopayChips';
import {
  chargeAmountCents,
  formatBalance,
  formatCardExpiry,
  planAmountLabel,
  planFrequencyLabel,
  sourceLabel,
  type AutopayRow,
  type DerivedAutopay,
} from './autopayLogic';

type HistoryPayment = { id: string; amountCents: number; method: string; paidAt: string; note: string | null; stub: boolean };
type HistoryAttempt = { id: string; amountCents: number; status: string; failureReason: string | null; chargedAt: string };
type HistoryResponse = { success: boolean; payments: HistoryPayment[]; attempts: HistoryAttempt[]; error?: string };

const DATE_OPTS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-900">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-100 px-5 py-4">
      <h3 className="mb-1 text-xs font-semibold text-slate-600">{title}</h3>
      {children}
    </section>
  );
}

export function AutopayDrawer({
  row,
  derived,
  timeZone,
  onClose,
}: {
  row: AutopayRow;
  derived: DerivedAutopay;
  timeZone: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const plan = row.plan;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    apiJson<HistoryResponse>(`/api/billing/autopay/history?clientId=${encodeURIComponent(row.clientId)}`)
      .then((res) => {
        if (cancelled) return;
        if (!res.success) throw new Error(res.error || 'Could not load charge history');
        setHistory(res);
      })
      .catch((e) => {
        if (!cancelled) setHistoryError(e instanceof Error ? e.message : 'Could not load charge history');
      });
    return () => {
      cancelled = true;
    };
  }, [row.clientId]);

  const date = (iso: string | null | undefined) => (iso ? formatPracticeDate(iso, timeZone, DATE_OPTS) : '—');

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close details" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-slate-900/30" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="autopay-drawer-title"
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 id="autopay-drawer-title" className="truncate text-lg font-semibold text-slate-900">{row.clientName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {row.mrn ? <span className="tabular-nums">MRN {row.mrn}</span> : null}
              <StatusChip status={derived.status} />
              <SourceChip source={sourceLabel(row)} />
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <Section title="Plan">
          <dl>
            <Field label="Amount">{planAmountLabel(row)}</Field>
            <Field label="Frequency">{planFrequencyLabel(row)}</Field>
            <Field label="Next charge">
              {plan?.nextChargeAt ? (
                <>
                  {date(plan.nextChargeAt)} <span className="text-slate-500">· {formatCents(chargeAmountCents(row))}</span>
                </>
              ) : (
                '—'
              )}
            </Field>
            <Field label="Ends">{plan?.endsAt ? date(plan.endsAt) : plan ? 'Never' : '—'}</Field>
            <Field label="AutoPay">{row.active ? 'On' : 'Off'}</Field>
            <Field label="Ledger balance">
              <span className={`tabular-nums ${(row.balanceCents ?? 0) < 0 ? 'text-emerald-700' : ''}`}>{formatBalance(row.balanceCents)}</span>
            </Field>
          </dl>
        </Section>

        <Section title="Card">
          <dl>
            <Field label="Card">
              <CardCell card={derived.card} testToken={row.card?.testToken} />
            </Field>
            <Field label="Held in">
              {row.card ? (row.card.inStripe ? 'Stripe' : 'Altrixs record only (not a Stripe card)') : derived.card.where === 'valant' ? 'Valant (not transferred)' : '—'}
            </Field>
          </dl>
          {derived.needsCard ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No card is saved in Altrixs for this client, so nothing can be charged. Card setup through Stripe is not connected yet.
            </p>
          ) : null}
        </Section>

        {plan?.source === 'valant' ? (
          <Section title="Imported from Valant">
            <dl>
              <Field label="Valant plan">{plan.planStatus ?? '—'}</Field>
              <Field label="Valant flag">{plan.statusFlag ?? '—'}</Field>
              <Field label="Amount (as exported)">{plan.amountLabel ?? '—'}</Field>
              <Field label="Card label">{plan.cardLabel ?? '—'}</Field>
              <Field label="Card exp">{formatCardExpiry(plan.cardExpiry) ?? '—'}</Field>
              <Field label="Valant balance">
                {plan.sourceBalanceCents != null ? (
                  <>
                    <span className="tabular-nums">{formatBalance(plan.sourceBalanceCents)}</span>
                    {plan.sourceAsOf ? <span className="text-slate-500"> as of {date(plan.sourceAsOf)}</span> : null}
                  </>
                ) : (
                  '—'
                )}
              </Field>
            </dl>
            <p className="mt-2 text-xs text-slate-500">Reference only. The Valant balance is never posted to the Altrixs ledger.</p>
          </Section>
        ) : null}

        <Section title="Charge history">
          {historyError ? (
            <p className="text-sm text-rose-700">{historyError}</p>
          ) : !history ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Loading…
            </p>
          ) : history.payments.length === 0 && history.attempts.length === 0 ? (
            <p className="text-sm text-slate-500">No patient payments or charge attempts recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-600">
                    <th scope="col" className="py-1.5 pr-3">Date</th>
                    <th scope="col" className="py-1.5 pr-3">Type</th>
                    <th scope="col" className="py-1.5 pr-3 text-right">Amount</th>
                    <th scope="col" className="py-1.5">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.attempts.map((a) => (
                    <tr key={`a-${a.id}`}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{formatPracticeDateTime(a.chargedAt, timeZone, { dateOpts: DATE_OPTS })}</td>
                      <td className="py-1.5 pr-3">Card charge</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCents(a.amountCents)}</td>
                      <td className={`py-1.5 ${a.status === 'failed' ? 'text-rose-700' : 'text-slate-700'}`}>
                        {a.status}
                        {a.failureReason ? ` · ${a.failureReason}` : ''}
                      </td>
                    </tr>
                  ))}
                  {history.payments.map((p) => (
                    <tr key={`p-${p.id}`}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{formatPracticeDateTime(p.paidAt, timeZone, { dateOpts: DATE_OPTS })}</td>
                      <td className="py-1.5 pr-3">
                        {p.stub ? 'Test charge (no money moved)' : `Payment · ${p.method.toLowerCase()}`}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCents(p.amountCents)}</td>
                      <td className="py-1.5 text-slate-500">{p.note ?? 'Recorded'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <footer className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 px-5 py-4">
          <Link
            href={`/dashboard/clients/${row.clientId}`}
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Open chart
          </Link>
          <Link
            href="/dashboard/billing/payments"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Payments ledger
          </Link>
        </footer>
      </aside>
    </div>
  );
}
