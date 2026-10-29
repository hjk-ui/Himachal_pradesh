import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { summarizeRiskAlerts } from '@/lib/alerts/manage';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const summary = await summarizeRiskAlerts({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    return NextResponse.json({ success: true, ...summary, summary });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    console.error('[risk-alerts summary GET]', err);
    if (code === 'P1001') {
      return NextResponse.json(
        { success: false, error: 'Database connection is temporarily unavailable. Please try again.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ success: false, error: 'Failed to load summary' }, { status: 500 });
  }
}
