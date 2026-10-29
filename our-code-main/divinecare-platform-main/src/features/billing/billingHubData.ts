import {
  CPT_CODES,
  cptDescription as sharedDesc,
  cptRateCents as sharedRate,
  type CptCode,
} from '@/lib/constants/cpt';

/** @deprecated Prefer CPT_CODES from @/lib/constants/cpt — kept for existing imports. */
export const CPT_CATALOG: Record<string, { description: string; rateCents?: number }> =
  Object.fromEntries(
    CPT_CODES.map((c: CptCode) => [
      c.code,
      { description: c.desc, rateCents: Math.round(c.rate * 100) },
    ])
  );

export function cptDescription(code: string) {
  return sharedDesc(code);
}

export function cptRateCents(code: string) {
  return sharedRate(code);
}

export type BillingInvoice = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  serviceLabel: string;
  amountCents: number;
  dueDate: string;
  status: 'outstanding' | 'overdue' | 'paid' | 'draft';
  note?: string;
  reminderSentAt?: string;
};
