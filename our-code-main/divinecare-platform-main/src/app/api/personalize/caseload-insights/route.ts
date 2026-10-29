import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
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

export async function POST() {
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
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Caseload insights failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
