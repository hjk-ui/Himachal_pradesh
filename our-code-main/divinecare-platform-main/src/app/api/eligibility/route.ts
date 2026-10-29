import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessEligibility, listEligibilityChecks } from '@/lib/eligibility/manage';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessEligibility(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/ehr/eligibility')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const checks = await listEligibilityChecks({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    return NextResponse.json({ success: true, checks });
  } catch (err) {
    console.error('[eligibility GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load eligibility checks' },
      { status: 500 }
    );
  }
}
