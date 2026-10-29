import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { isCaseloadRole, isMedicalRole } from '@/types/roles';
import { loadValantSection, type ValantSection } from '@/lib/billing/overview';
import {
  canViewBillingOverview,
  FAMILY_PRACTICE_FACILITY,
  NO_FAMILY_PRACTICE_NOTE,
  type OverviewRange,
} from '@/lib/billing/overviewValant';
import { daysInAr, nonDeniedClaimShare } from '@/lib/medical/billingMetrics';

/**
 * GET /api/medical/billing/summary data: primary-care billing, two sources never summed.
 *  - Valant (imported): ValantTransaction rows whose Transaction Journal facility is Family Practice.
 *    Primary care is identified by facility only, never by CPT (psychiatry also bills E/M 99212-99215).
 *  - Altrixs (live): MedicalCharge rows (none before go-live).
 * Valant money is organization-wide for billing / leadership; primary care and caseload roles see only
 * rows of clients they may open; other roles on the page do not get Valant totals.
 */

export type ValantAccess = 'organization' | 'caseload' | 'hidden';

export function medicalValantAccess(role: string | null | undefined): ValantAccess {
  if (canViewBillingOverview(role)) return 'organization';
  if (isMedicalRole(role ?? '') || isCaseloadRole(role)) return 'caseload';
  return 'hidden';
}

export type MedicalBillingSummary = {
  range: { preset: OverviewRange['preset']; fromDate: string; toDate: string };
  valantAccess: ValantAccess;
  /** organization-wide Family Practice rows (0 until the Transaction Journal is imported) */
  familyPracticeRows: number;
  emptyNote: string | null;
  valant: ValantSection | null;
  altrixs: {
    total: number;
    billedCents: number;
    byStatus: Record<string, number>;
    inRange: { count: number; billedCents: number; paidCount: number; deniedCount: number };
    /** charges not denied ÷ all charges (not a clean-claim rate); null with no charges */
    nonDeniedShare: number | null;
    /** open payer A/R ÷ average daily charges, last 90 days of service; null = not enough data */
    daysInAr: number | null;
    emptyNote: string | null;
  };
};

export async function getMedicalBillingSummary(
  viewer: { organizationId: string; userId: string; role: string },
  range: OverviewRange,
  now = new Date()
): Promise<MedicalBillingSummary> {
  const { organizationId } = viewer;
  const access = medicalValantAccess(viewer.role);
  const clientWhere = clientAccessWhere({ organizationId, actorUserId: viewer.userId, actorRole: viewer.role as Role });
  const facility = { contains: FAMILY_PRACTICE_FACILITY };

  const [familyPracticeRows, charges] = await Promise.all([
    prisma.valantTransaction.count({ where: { organizationId, facility: { contains: FAMILY_PRACTICE_FACILITY, mode: 'insensitive' } } }),
    prisma.medicalCharge.findMany({
      where: { organizationId, client: clientWhere },
      select: { status: true, amountCents: true, dos: true },
    }),
  ]);

  const valant =
    access !== 'hidden' && familyPracticeRows > 0
      ? await loadValantSection(organizationId, range, { facility, clientWhere: access === 'caseload' ? clientWhere : null })
      : null;

  const byStatus: Record<string, number> = {};
  const inRange = { count: 0, billedCents: 0, paidCount: 0, deniedCount: 0 };
  let billedCents = 0;
  for (const c of charges) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    billedCents += c.amountCents;
    if (c.dos >= range.valantFrom && c.dos < range.valantToExclusive) {
      inRange.count += 1;
      inRange.billedCents += c.amountCents;
      if (c.status === 'Paid') inRange.paidCount += 1;
      if (c.status === 'Denied') inRange.deniedCount += 1;
    }
  }
  const metricRows = charges.map((c) => ({ status: c.status, billedAmount: c.amountCents / 100, dos: c.dos.toISOString().slice(0, 10) }));
  const dar = daysInAr(metricRows, now);

  return {
    range: { preset: range.preset, fromDate: range.fromDate, toDate: range.toDate },
    valantAccess: access,
    familyPracticeRows,
    emptyNote: familyPracticeRows > 0 ? null : NO_FAMILY_PRACTICE_NOTE,
    valant,
    altrixs: {
      total: charges.length,
      billedCents,
      byStatus,
      inRange,
      nonDeniedShare: nonDeniedClaimShare(metricRows),
      daysInAr: dar == null ? null : Math.round(dar * 10) / 10,
      emptyNote: charges.length ? null : 'No Altrixs medical charges yet — charges start after go-live.',
    },
  };
}
