import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { isCaseloadRole } from '@/types/roles';
import { getCopingTools } from '@/lib/aws/personalize';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

function canUsePersonalize(role: string) {
  return (
    isCaseloadRole(role) ||
    canAccessPath(role, '/dashboard/ai-insights') ||
    canAccessPath(role, '/dashboard/scribe')
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUsePersonalize(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  try {
    const result = await getCopingTools({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      clientId: id,
    });
    await auditPhiAccess({
      gate,
      req,
      action: 'AI_ACCESS',
      resourceType: 'personalize',
      resourceId: 'coping-tools',
      patientId: id,
      metadata: { service: 'aws-personalize', feature: 'coping-tools', available: result.available, count: result.available ? result.tools.length : 0 },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 404) {
      await auditPhiAccess({
        gate,
        req,
        action: 'AI_ACCESS',
        resourceType: 'personalize',
        resourceId: 'coping-tools',
        patientId: id,
        outcome: 'DENIED',
        metadata: { service: 'aws-personalize', feature: 'coping-tools', reason: 'client-not-accessible' },
      });
    }
    const message = err instanceof Error ? err.message : 'Coping tools failed';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
