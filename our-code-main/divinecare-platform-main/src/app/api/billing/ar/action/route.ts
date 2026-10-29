import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  AR_WORKLIST_ACTIONS,
  canAccessArControl,
  runArWorklistAction,
} from '@/lib/billing/arControl';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

const bodySchema = z.object({
  claimId: z.string().min(1).max(128),
  action: z.enum(AR_WORKLIST_ACTIONS),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessArControl(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/ar-control')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    const result = await runArWorklistAction(actorFrom(gate), body.claimId, body.action, body.note);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid A/R action' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not run A/R action' }, { status: 400 });
  }
}
