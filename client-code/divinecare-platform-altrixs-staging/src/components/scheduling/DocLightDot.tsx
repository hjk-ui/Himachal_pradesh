'use client';

import { CircleDollarSign } from 'lucide-react';
import { cx } from '@/components/ui';
import {
  DOC_LIGHT_DOT,
  DOC_LIGHT_LEGEND,
  VISIT_PAYMENT_LABEL,
  type DocLight,
  type VisitPayment,
} from '@/lib/appointments/docLight';

/** "Documentation: Note overdue (No note yet · past the 72-hour deadline)" — for aria-labels and tooltips. */
export function docLightText(light: DocLight | null | undefined): string {
  if (!light) return '';
  return `Documentation: ${light.label}${light.detail ? ` (${light.detail})` : ''}`;
}

/**
 * Small documentation status dot (grey / blue / amber / red / green) with a tooltip and
 * screen-reader text. Colour is never the only signal: the label is in the title and sr-only text.
 */
export function DocLightDot({ light, size = 'sm', className }: { light: DocLight | null | undefined; size?: 'sm' | 'md'; className?: string }) {
  if (!light) return null;
  const text = docLightText(light);
  return (
    <span title={text} className={cx('inline-flex shrink-0 items-center', className)}>
      <span
        aria-hidden
        className={cx(
          'inline-block rounded-full ring-2 ring-white',
          size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5',
          DOC_LIGHT_DOT[light.tone],
        )}
      />
      <span className="sr-only">{text}</span>
    </span>
  );
}

const PAYMENT_TONE: Record<VisitPayment, string> = {
  collected: 'text-emerald-700',
  pending: 'text-sky-700',
  failed: 'text-rose-700',
};

/** Copay icon for the visit (front office / billing roles; nothing when no payment is recorded). */
export function VisitPaymentIcon({ payment, className }: { payment: VisitPayment | null | undefined; className?: string }) {
  if (!payment) return null;
  const text = VISIT_PAYMENT_LABEL[payment];
  return (
    <span title={text} className={cx('inline-flex shrink-0 items-center', PAYMENT_TONE[payment], className)}>
      <CircleDollarSign className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** Legend for the documentation lights (scheduler toolbar). */
export function DocLightLegend({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-3 text-xs text-slate-600', className)} aria-label="Documentation status lights">
      {DOC_LIGHT_LEGEND.map((l) => (
        <span key={l.tone} className="inline-flex items-center gap-1.5 font-medium">
          <span aria-hidden className={cx('h-2.5 w-2.5 rounded-full', DOC_LIGHT_DOT[l.tone])} />
          {l.label}
        </span>
      ))}
    </div>
  );
}
