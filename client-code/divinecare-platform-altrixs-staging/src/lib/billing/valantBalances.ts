import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { DEFAULT_AGING_LABELS, normalizeAgingLabels } from '@/lib/migration/valantAging';
import { pickCopayRule, providerTypeForRole, type CopayPick } from '@/lib/migration/valantCopays';
import { prepaymentStanding } from '@/lib/migration/valantPrepayments';
import { isoDate } from '@/lib/migration/valantReportCommon';
import { presentAgingBuckets, sumPresented } from '@/lib/billing/valantAgingDisplay';

export { OVER_120_NOTE, presentAgingBuckets, presentAgingTotals, sumPresented, type PresentedBuckets } from '@/lib/billing/valantAgingDisplay';

/**
 * Valant reference-only balances (aging, insurance A/R, prepayments) and copay rules.
 * Read helpers for API routes. Nothing here writes the Altrixs ledger (posting lives in patientLedger.ts).
 */

export const VALANT_BALANCES_PATH = '/dashboard/billing/valant-balances';
/** Valant report copies are reference data. Patient opening balances and prepayment credits reach the ledger only
 *  when billing posts them (patientLedger.ts); insurance A/R is a Valant run-out and is never posted. */
export const REFERENCE_ONLY_NOTE =
  'Reference copy of Valant reports — patient opening balances and prepayment credits are on the ledger only when posted from Valant Balances; insurance A/R stays in Valant (run-out)';

/** Billing roles + leadership (same rule as the page in roleAccess) */
export function canViewValantBalances(role: string | null | undefined): boolean {
  return canAccessPath(role, VALANT_BALANCES_PATH);
}

export async function getAgingLabels(organizationId: string) {
  const s = await prisma.valantAgingSettings.findUnique({ where: { organizationId } });
  return {
    labels: s ? normalizeAgingLabels(s.labels) : [...DEFAULT_AGING_LABELS],
    confirmed: Boolean(s?.confirmed),
    confirmedAt: s?.confirmedAt?.toISOString() ?? null,
    /** Owner decision 2026-10-17: default on (no settings row = on) */
    displayAllOver120: s ? s.displayAllOver120 : true,
  };
}

/** One stored Valant row presented for display (display + original buckets); stored data is never changed */
export function presentRow(r: BucketRow & { totalCents: number }, allOver120: boolean) {
  return presentAgingBuckets(bucketsOf(r), r.totalCents, allOver120);
}

export type BucketRow = { bucket1Cents: number; bucket2Cents: number; bucket3Cents: number; bucket4Cents: number; bucket5Cents: number };
export const bucketsOf = (r: BucketRow) => [r.bucket1Cents, r.bucket2Cents, r.bucket3Cents, r.bucket4Cents, r.bucket5Cents];

/** Latest prepayment report period for the organization */
export async function latestPrepaymentPeriod(organizationId: string) {
  const imp = await prisma.valantReferenceImport.findFirst({
    where: { organizationId, reportType: 'prepayments' },
    orderBy: { importedAt: 'desc' },
    select: { periodStart: true, periodEnd: true, importedAt: true },
  });
  return imp
    ? { periodStart: isoDate(imp.periodStart), periodEnd: isoDate(imp.periodEnd), importedAt: imp.importedAt.toISOString() }
    : null;
}

/** Chart card data for one client; null parts when nothing was imported */
export async function clientValantReference(organizationId: string, clientId: string) {
  const latestCombined = await prisma.valantCombinedAgingRow.findFirst({
    where: { organizationId, clientId },
    orderBy: { asOf: 'desc' },
    select: { asOf: true },
  });
  const [aging, txns, period, labels, combined, transactionCount] = await Promise.all([
    prisma.valantAgingSnapshot.findFirst({
      where: { organizationId, clientId },
      orderBy: { asOf: 'desc' },
    }),
    prisma.valantPrepaymentTxn.findMany({
      where: { organizationId, clientId },
      select: { amountCents: true, periodStart: true, periodEnd: true },
    }),
    latestPrepaymentPeriod(organizationId),
    getAgingLabels(organizationId),
    latestCombined
      ? prisma.valantCombinedAgingRow.findMany({
          where: { organizationId, clientId, asOf: latestCombined.asOf },
          orderBy: { rowIndex: 'asc' },
        })
      : Promise.resolve([]),
    prisma.valantTransaction.count({ where: { organizationId, clientId } }),
  ]);
  const net = txns.reduce((s, t) => s + t.amountCents, 0);
  const over120 = labels.displayAllOver120;
  const parties = combined.map((l) => ({
    party: l.party, payerName: l.payerName, lastBilledAt: isoDate(l.lastBilledAt), ...presentRow(l, over120),
  }));
  const periodStart = period?.periodStart ?? (txns[0] ? isoDate(txns[0].periodStart) : null);
  const periodEnd = period?.periodEnd ?? (txns[0] ? isoDate(txns[0].periodEnd) : null);
  return {
    labels,
    transactionCount,
    aging: aging
      ? { asOf: isoDate(aging.asOf), ...presentRow(aging, over120), bucketsMatchTotal: aging.bucketsMatchTotal }
      : null,
    prepayment: txns.length
      ? { transactions: txns.length, periodStart, periodEnd, ...prepaymentStanding(net, periodStart) }
      : null,
    combined: latestCombined && combined.length
      ? {
          asOf: isoDate(latestCombined.asOf),
          ...sumPresented(parties, over120),
          parties,
        }
      : null,
  };
}

/** A client's copay rules for display (blank provider type / CPT = applies to all) */
export async function clientCopayRules(organizationId: string, clientId: string) {
  const copayRules = await prisma.clientCopayRule.findMany({
    where: { organizationId, clientId },
    orderBy: [{ payerName: 'asc' }, { providerType: 'asc' }, { cptRule: 'asc' }],
  });
  return copayRules.map((r) => ({
    id: r.id,
    payerName: r.payerName,
    providerType: r.providerType || null,
    cptRule: r.cptRule || null,
    amountCents: r.amountCents,
    valantLimitRaw: r.valantLimitRaw,
    valantLimitCents: r.valantLimitCents,
    source: r.source,
  }));
}

/**
 * Patient copay for a visit from the client's copay rules (most specific: CPT > provider type > blank).
 * providerRole is the Altrixs staff role of the rendering provider (mapped to Valant's provider type).
 * Does not read or change Client.copayAmount.
 */
export async function copayFor(
  organizationId: string,
  clientId: string,
  q: { payerName?: string | null; providerRole?: string | null; providerType?: string | null; cpt?: string | null }
): Promise<CopayPick<{ id: string; payerName: string; providerType: string; cptRule: string; amountCents: number; source: string }>> {
  const rules = await prisma.clientCopayRule.findMany({
    where: { organizationId, clientId },
    select: { id: true, payerName: true, providerType: true, cptRule: true, amountCents: true, source: true, valantLimitCents: true },
  });
  return pickCopayRule(rules, {
    payerName: q.payerName,
    providerType: q.providerType ?? providerTypeForRole(q.providerRole),
    cpt: q.cpt,
  });
}

/** Who can see a client's copay rules: anyone who collects payments (front desk, billing, medical) */
export function canViewCopayRules(role: string | null | undefined): boolean {
  return canAccessPath(role, '/dashboard/billing/payments') || canViewValantBalances(role);
}

/** Report totals saved with the latest import of this report type and as-of date */
export async function importTotals(organizationId: string, reportType: string, asOf: Date) {
  const imp = await prisma.valantReferenceImport.findFirst({
    where: { organizationId, reportType, asOf },
    orderBy: { importedAt: 'desc' },
  });
  return imp ? { importedAt: imp.importedAt.toISOString(), reconciles: imp.reconciles, totals: imp.totalsJson } : null;
}
