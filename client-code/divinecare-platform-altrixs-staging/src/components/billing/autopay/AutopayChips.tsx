'use client';

import type { AutopayStatus, CardSummary } from './autopayLogic';
import { STATUS_LABEL } from './autopayLogic';

const STATUS_STYLE: Record<AutopayStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  paused: 'bg-slate-100 text-slate-600 ring-slate-200',
  past_due: 'bg-rose-50 text-rose-700 ring-rose-200',
  ended: 'bg-slate-50 text-slate-500 ring-slate-200',
  needs_card: 'bg-amber-50 text-amber-800 ring-amber-200',
};

export function StatusChip({ status }: { status: AutopayStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SourceChip({ source }: { source: 'Valant' | 'Altrixs' }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
        source === 'Valant' ? 'bg-sky-50 text-sky-700 ring-sky-200' : 'bg-blue-50 text-blue-700 ring-blue-200'
      }`}
    >
      {source}
    </span>
  );
}

/** Brand •••• last4 and exp MM/YY; red chip when expired or expiring within 30 days. */
export function CardCell({ card, testToken }: { card: CardSummary; testToken?: boolean }) {
  if (!card.last4 && !card.expiry) {
    return <span className="text-slate-500">No card</span>;
  }
  return (
    <div className="min-w-0">
      <div className="whitespace-nowrap font-medium text-slate-800">
        {card.brand ?? 'Card'} <span className="tabular-nums">•••• {card.last4 ?? '????'}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
        {card.expiry ? <span className="tabular-nums">exp {card.expiry}</span> : null}
        {card.expiryState === 'expired' ? (
          <span className="rounded-full bg-rose-50 px-1.5 py-px text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">Expired</span>
        ) : card.expiryState === 'expiring' ? (
          <span className="rounded-full bg-rose-50 px-1.5 py-px text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">Expires soon</span>
        ) : null}
        {card.where === 'valant' ? <span className="text-amber-700">In Valant only</span> : null}
        {testToken ? <span className="text-amber-700">Test token</span> : null}
      </div>
    </div>
  );
}
