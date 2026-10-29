'use client';

import Link from 'next/link';
import { CheckCircle2, FileWarning } from 'lucide-react';
import { TREATMENT_PLAN_PENDING_LABEL } from '@/lib/practice/clinical-settings';

type Props = {
  noteId?: string | null;
  clientId?: string | null;
  exceptionLabel?: string | null;
  onDismiss?: () => void;
};

export function AfterSignBanner({ noteId, clientId, exceptionLabel, onDismiss }: Props) {
  if (!noteId && !exceptionLabel) return null;

  const pending = exceptionLabel === TREATMENT_PLAN_PENDING_LABEL || Boolean(exceptionLabel);

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        pending
          ? 'border-amber-200 bg-amber-50'
          : 'border-emerald-200 bg-emerald-50'
      }`}
      data-testid="after-sign-banner"
    >
      <div className="flex flex-wrap items-start gap-3">
        {pending ? (
          <FileWarning size={18} className="mt-0.5 shrink-0 text-amber-700" />
        ) : (
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${pending ? 'text-amber-950' : 'text-emerald-950'}`}>
            {pending ? exceptionLabel : 'Note signed'}
          </p>
          <p className={`mt-0.5 text-xs ${pending ? 'text-amber-800' : 'text-emerald-800'}`}>
            {pending
              ? 'Go-live transition allows signing without an active treatment plan until go-live + 30 days. Complete the plan soon.'
              : 'Next: create the claim draft if billable, book follow-up, and complete Visit Guide wrap-up.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {clientId ? (
              <Link
                href="/dashboard/ehr/treatment-plans"
                className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                Treatment plans
              </Link>
            ) : null}
            <Link
              href="/dashboard/billing/claims"
              className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Claims
            </Link>
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white/70"
              >
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
