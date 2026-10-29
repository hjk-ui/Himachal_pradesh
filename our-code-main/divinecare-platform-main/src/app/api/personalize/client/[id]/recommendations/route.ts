import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { isCaseloadRole } from '@/types/roles';
import { getClientRecommendations } from '@/lib/aws/personalize';

export const runtime = 'nodejs';

function canUsePersonalize(role: string) {
  return (
    isCaseloadRole(role) ||
    canAccessPath(role, '/dashboard/ai-insights') ||
    canAccessPath(role, '/dashboard/scribe')
  );
}

export async function GET(
  _req: Request,
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
    const result = await getClientRecommendations({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      clientId: id,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : 'Recommendations failed';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
