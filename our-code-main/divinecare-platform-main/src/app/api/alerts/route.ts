import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { listRiskAlerts, summarizeRiskAlerts } from '@/lib/alerts/manage';

export const runtime = 'nodejs';

/** Legacy path — same data as GET /api/risk-alerts */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
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

    const [alerts, summary] = await Promise.all([
      listRiskAlerts({ ...ctx, unreviewed }),
      summarizeRiskAlerts(ctx),
    ]);
    return NextResponse.json({ success: true, alerts, summary });
  } catch (err) {
    console.error('[alerts GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to load alerts' }, { status: 500 });
  }
}
