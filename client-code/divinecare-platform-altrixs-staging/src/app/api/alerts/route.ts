import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listRiskAlerts, summarizeRiskAlerts } from '@/lib/alerts/manage';
import { maskAlertsForViewer } from '@/lib/alerts/lockedMask';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** Legacy path — same data as GET /api/risk-alerts */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Same rule as GET /api/risk-alerts (in-route, not only the API path table)
  if (!canAccessPath(gate.role, '/dashboard/alerts', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const unreviewedParam = searchParams.get('unreviewed');
    let unreviewed: boolean | null = null;
    if (unreviewedParam === 'true' || unreviewedParam === '1') unreviewed = true;
    if (unreviewedParam === 'false' || unreviewedParam === '0') unreviewed = false;

    const ctx = {
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    };

    const [rawAlerts, summary] = await Promise.all([
      listRiskAlerts({ ...ctx, unreviewed }),
      summarizeRiskAlerts(ctx),
    ]);
    const alerts = await maskAlertsForViewer(gate, rawAlerts);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'riskAlert',
      metadata: {
        route: 'legacy_alerts',
        count: alerts.length,
        masked: alerts.filter((a) => a.protected).length,
        filters: { unreviewed },
        alertIds: alerts.slice(0, 50).map((a) => a.id),
      },
    });
    return NextResponse.json({ success: true, alerts, summary });
  } catch (err) {
    console.error('[alerts GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to load alerts' }, { status: 500 });
  }
}
