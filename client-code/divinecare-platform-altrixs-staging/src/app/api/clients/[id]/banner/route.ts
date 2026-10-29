import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadChartBanner } from '@/lib/clients/chartBanner';
import { canSeeChartBilling, prismaChartBannerSource } from '@/lib/clients/chartAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/clients/[id]/banner — sticky patient banner for the client chart.
 * Org-scoped, roster roles only, caseload roles only for their clients (same rule as the chart),
 * protected / 42 CFR Part 2 records: lock + alias only unless the viewer is cleared.
 * Patient balance only for roles that can read the billing ledger.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const path = `/api/clients/${id}/banner`;
  try {
    const result = await loadChartBanner(
      prismaChartBannerSource(path),
      { organizationId: gate.organizationId, userId: gate.userId, role: gate.role, billingVisible: canSeeChartBilling(gate.role) },
      id
    );
    if (result.ok === false) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clientBanner', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: result.reason } });
      return NextResponse.json({ success: false, error: result.status === 404 ? 'Client not found' : 'Forbidden' }, { status: result.status });
    }
    const b = result.banner;
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'clientBanner',
      resourceId: id,
      patientId: id,
      outcome: b.locked ? 'DENIED' : 'SUCCESS',
      metadata: b.locked ? { reason: 'sensitive_record', view: 'locked_banner' } : { billingVisible: (b as { billingVisible: boolean }).billingVisible },
    });
    return NextResponse.json({ success: true, banner: b }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[api/clients/[id]/banner GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the patient banner' }, { status: 500 });
  }
}
