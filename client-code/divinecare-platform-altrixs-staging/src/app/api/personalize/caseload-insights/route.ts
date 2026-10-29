import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { isCaseloadRole } from '@/types/roles';
import { getCaseloadInsights } from '@/lib/aws/personalize';

export const runtime = 'nodejs';

function canUsePersonalize(role: string) {
  return (
    isCaseloadRole(role) ||
    canAccessPath(role, '/dashboard/ai-insights') ||
    canAccessPath(role, '/dashboard/scribe')
  );
}

/**
 * POST /api/personalize/caseload-insights — Amazon Personalize output for the signed-in staff
 * member. `available: false` (no items) whenever Personalize is not configured or returns
 * nothing; real caseload numbers come from GET /api/dashboard/home.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUsePersonalize(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await getCaseloadInsights({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    if (result.available) {
      await auditPhiAccess({
        gate,
        req,
        action: 'AI_ACCESS',
        resourceType: 'personalize',
        resourceId: 'caseload-insights',
        metadata: { service: 'aws-personalize', feature: 'caseload-insights', count: result.items.length },
      });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[personalize/caseload-insights]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Caseload insights failed' }, { status: 500 });
  }
}
