import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessStatements, sendExistingStatement } from '@/lib/billing/statements';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessStatements(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/statements')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    const result = await sendExistingStatement(actorFrom(gate), id);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[billing statements send]', err);
    return NextResponse.json({ success: false, error: 'Could not send statement' }, { status: 500 });
  }
}
