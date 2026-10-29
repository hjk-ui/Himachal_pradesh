import { PAYER_LIST } from '@/lib/constants/payers';

/** Exact Warm Handoff / calendar payer labels (Oct 22). */
export const PAYER_MISMATCH_LABEL = 'Payer mismatch';
export const INSURANCE_NOT_MATCHED_LABEL = 'Insurance not matched to a payer';

export function isKnownPayerLabel(value: string | null | undefined): boolean {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) return false;
  // Exact catalog label only — free-text like "Maryland Medicaid" stays unmatched (neutral).
  return PAYER_LIST.some((p) => p.label.toLowerCase() === raw || p.id.toLowerCase() === raw);
}

/**
 * Neutral free-text insurance → "Insurance not matched to a payer"
 * Known list entry that conflicts with accepted payers → "Payer mismatch"
 */
export function resolvePayerHintDisplay(
  insurance: string | null | undefined,
  acceptedPayers?: string[] | null
): { label: string | null; tone: 'neutral' | 'danger' | 'ok' } {
  const raw = (insurance || '').trim();
  if (!raw) return { label: null, tone: 'ok' };
  if (!isKnownPayerLabel(raw)) {
    return { label: INSURANCE_NOT_MATCHED_LABEL, tone: 'neutral' };
  }
  if (acceptedPayers && acceptedPayers.length > 0) {
    const hit = acceptedPayers.some((p) => p.toLowerCase().includes(raw.toLowerCase()) || raw.toLowerCase().includes(p.toLowerCase()));
    if (!hit) return { label: PAYER_MISMATCH_LABEL, tone: 'danger' };
  }
  return { label: raw, tone: 'ok' };
}
