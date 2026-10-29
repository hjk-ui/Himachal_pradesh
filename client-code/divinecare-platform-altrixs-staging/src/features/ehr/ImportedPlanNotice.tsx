'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, FileInput, FileText, PenLine } from 'lucide-react';
import { importedPlanSummary, type ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';
import { planDateView, rewriteHref } from '@/lib/ehr/importedPlans';
import { clinicDate } from '@/lib/workflows/dates';
import { buttonClasses } from '@/components/ui';

/** Small "Imported from Valant" tag for plan lists */
export function ImportedPlanBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      <FileInput size={11} aria-hidden /> Imported from Valant
    </span>
  );
}

/**
 * Banner for a plan imported from Valant. Valant's plan grid exported status, last update, next
 * review and providers only, so the banner shows Valant's own dates (never the import date as a
 * start), flags an overdue review, and offers "Rewrite in Altrixs" when the plan and client are
 * known.
 */
export function ImportedPlanNotice({
  source,
  compact = false,
  reviewDueAt,
  status,
  clientId,
  planId,
  rewriteDraftId = null,
}: {
  source: ImportedPlanSource;
  compact?: boolean;
  /** TreatmentPlan.reviewDueAt (Valant's Next Review); pass it to show the dates line */
  reviewDueAt?: string | null;
  status?: string;
  /** With planId: show the "Rewrite in Altrixs" action */
  clientId?: string;
  planId?: string;
  rewriteDraftId?: string | null;
}) {
  const [today] = useState(() => clinicDate());
  const summary = importedPlanSummary(source);
  const dates = reviewDueAt !== undefined ? planDateView({ source, createdAt: null, reviewDueAt, status: status ?? 'ACTIVE', today }) : null;
  const closed = status === 'CLOSED';
  const notActive = Boolean(dates && !closed && (dates.overdue || !dates.reviewDay || status === 'DRAFT'));
  return (
    <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <FileInput size={14} aria-hidden /> Imported from Valant
      </p>
      {dates ? (
        <p className="mt-1 text-xs">
          {dates.startLabel} · {dates.lastUpdatedLabel ?? 'Last update: not in Valant export'}
          {source.owner ? ` by ${source.owner}` : ''} ·{' '}
          <span className={dates.overdue && !closed ? 'font-semibold text-rose-700' : ''}>{dates.reviewLabel}</span>
        </p>
      ) : null}
      {notActive && dates ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-800">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {status === 'DRAFT'
              ? 'This plan is a draft in Valant (never finalized).'
              : dates.overdue
                ? `Review overdue by ${dates.daysOverdue} day${dates.daysOverdue === 1 ? '' : 's'}.`
                : 'Valant exported no next review date.'}{' '}
            It does not count as an active plan: therapy progress notes and psychotherapy, group (90853) and case management (T1016 / T1017) notes cannot be signed until a
            plan written in Altrixs is signed.
          </span>
        </p>
      ) : null}
      <p className="mt-1 text-xs leading-relaxed">
        Plan content (goals, objectives, interventions) is in Valant and was not in the export.
        {!dates && summary ? ` ${summary}` : ''}
      </p>
      {!compact && (source.supervisor || source.otherProviders.length > 0) ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {source.supervisor ? (
            <div>
              <dt className="font-semibold">Supervisor</dt>
              <dd>{source.supervisor}</dd>
            </div>
          ) : null}
          {source.otherProviders.length ? (
            <div>
              <dt className="font-semibold">Other providers</dt>
              <dd>{source.otherProviders.join('; ')}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {!compact && source.valantStatus ? (
        <p className="mt-1 text-[11px] text-amber-800/80">Valant status: {source.valantStatus} · Signatures for this plan are recorded in Valant.</p>
      ) : null}
      {clientId && planId && !closed ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href={rewriteHref(clientId, planId, rewriteDraftId)}
            className={buttonClasses({ size: 'sm' })}
          >
            <PenLine size={13} aria-hidden /> {rewriteDraftId ? 'Continue rewrite in Altrixs' : 'Rewrite in Altrixs'}
          </Link>
          {!compact ? (
            <Link href="/dashboard/ehr/doc-intake" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
              <FileText size={12} aria-hidden /> Upload Valant plan PDFs (Smart Doc Intake)
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
