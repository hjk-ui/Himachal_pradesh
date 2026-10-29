import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { MEDICAL_BILLING_PATH, parseOverviewRange } from '@/lib/billing/overviewValant';
import { getMedicalBillingSummary } from '@/lib/medical/billingSummary';
import { canReadMedicalBillingSummary } from '@/lib/billing/billingAccess';

export const runtime = 'nodejs';

/**
 * GET /api/medical/billing/summary?preset=mtd|90d | ?from&to — primary-care billing summary:
 * Valant (imported, Family Practice facility) and Altrixs MedicalCharge (live) aggregates.
 * Practice-wide counts and sums: billing core only (providers see their own
 * charges on the page, not practice totals).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, MEDICAL_BILLING_PATH) || !canReadMedicalBillingSummary(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'medicalBillingSummary', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = parseOverviewRange(new URL(req.url).searchParams, new Date());
  if ('error' in parsed) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });

  try {
    const summary = await getMedicalBillingSummary(
      { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
      parsed.range
    );
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'medicalBillingSummary',
      metadata: {
        view: 'medical_billing_summary',
        from: parsed.range.fromDate,
        to: parsed.range.toDate,
        valantAccess: summary.valantAccess,
        familyPracticeRows: summary.familyPracticeRows,
        medicalCharges: summary.altrixs.total,
      },
    });
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    console.error('[medical billing summary]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load the medical billing summary' }, { status: 500 });
  }
}
