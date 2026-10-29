import { prisma } from '@/lib/db/prisma';
import {
  baseCptCodes,
  feeBaseCpt,
  pickFee,
  type FeeContext,
  type FeeItem,
  type FeeQuote,
  type FeeSource,
} from '@/lib/billing/feeSchedule';

/** Roles that may edit fee schedule rows (import is leadership-only, see requireImportGate). */
export const FEE_EDIT_ROLES = new Set(['ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'BILLING']);

type Row = Awaited<ReturnType<typeof prisma.feeScheduleItem.findMany>>[number];

export function toFeeItem(r: Row): FeeItem & { id: string } {
  return {
    id: r.id,
    code: r.code,
    description: r.description,
    feeCents: r.feeCents,
    billedCpt: r.billedCpt,
    baseCpt: r.baseCpt,
    telehealth: r.telehealth,
    selfPay: r.selfPay,
    child: r.child,
    itp: r.itp,
    exactOnly: r.exactOnly,
    variantLabel: r.variantLabel,
    insuranceBillable: r.insuranceBillable,
    needsReview: r.needsReview,
    reviewNote: r.reviewNote,
    active: r.active,
    source: (r.source === 'altrixs' ? 'altrixs' : 'valant') as FeeSource,
  };
}

/** Every fee schedule row of the org; [] when the table is missing (migration not applied yet). */
export async function loadFeeSchedule(organizationId: string, opts: { activeOnly?: boolean } = {}): Promise<(FeeItem & { id: string })[]> {
  try {
    const rows = await prisma.feeScheduleItem.findMany({
      where: { organizationId, ...(opts.activeOnly ? { active: true } : {}) },
      orderBy: { code: 'asc' },
    });
    return rows.map(toFeeItem);
  } catch (err) {
    console.warn('[feeSchedule] unavailable:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Fee for a visit: most specific fee schedule variant, then the base code, then the built-in
 * constants. Returns { feeCents, billedCpt, code, source, ... }.
 */
export async function feeFor(organizationId: string, ctx: FeeContext): Promise<FeeQuote> {
  return pickFee(await loadFeeSchedule(organizationId, { activeOnly: true }), ctx);
}

/** True when the code's base CPT is an active fee schedule item (or an insurance billed code). */
export async function feeScheduleHasCpt(organizationId: string, code: string): Promise<boolean> {
  const base = feeBaseCpt(code);
  if (!base) return false;
  const items = await loadFeeSchedule(organizationId, { activeOnly: true });
  return items.some((i) => i.baseCpt === base || (i.insuranceBillable && feeBaseCpt(i.billedCpt) === base));
}

/** Base CPTs present in the org fee schedule (for CPT pick lists). */
export async function feeScheduleCptCodes(organizationId: string) {
  return baseCptCodes(await loadFeeSchedule(organizationId, { activeOnly: true }));
}

export { visitContext } from '@/lib/billing/feeSchedule';
