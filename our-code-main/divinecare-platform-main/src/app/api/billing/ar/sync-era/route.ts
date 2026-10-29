import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessArControl, syncArEra } from '@/lib/billing/arControl';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function POST() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessArControl(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/ar-control')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const result = await syncArEra(actorFrom(gate));
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error, demoMode: result.demoMode },
      { status: result.status }
    );
  }
  return NextResponse.json({ success: true, ...result });
}
