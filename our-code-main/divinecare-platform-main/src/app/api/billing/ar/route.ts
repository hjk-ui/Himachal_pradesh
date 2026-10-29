import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessArControl, getArControlSnapshot } from '@/lib/billing/arControl';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessArControl(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/ar-control')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const data = await getArControlSnapshot(actorFrom(gate));
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[billing ar GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load A/R control data' }, { status: 500 });
  }
}
