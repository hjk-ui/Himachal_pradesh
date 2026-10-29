import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { isCaseloadRole } from '@/types/roles';
import { rankCopingTools } from '@/lib/aws/personalize';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const schema = z.object({
  toolIds: z.array(z.string().min(1).max(64)).min(1).max(20),
});

function canUsePersonalize(role: string) {
  return (
    isCaseloadRole(role) ||
    canAccessPath(role, '/dashboard/ai-insights') ||
    canAccessPath(role, '/dashboard/scribe')
  );
}

export async function POST(
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
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'toolIds array required' }, { status: 400 });
  }

  try {
    const result = await rankCopingTools({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      clientId: id,
      toolIds: body.toolIds,
    });
    await auditPhiAccess({
      gate,
      req,
      action: 'AI_ACCESS',
      resourceType: 'personalize',
      resourceId: 'rank-tools',
      patientId: id,
      metadata: { service: 'aws-personalize', feature: 'rank-tools', available: result.available, count: result.available ? result.ranked.length : 0 },
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
        resourceId: 'rank-tools',
        patientId: id,
        outcome: 'DENIED',
        metadata: { service: 'aws-personalize', feature: 'rank-tools', reason: 'client-not-accessible' },
      });
    }
    const message = err instanceof Error ? err.message : 'Rank tools failed';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
