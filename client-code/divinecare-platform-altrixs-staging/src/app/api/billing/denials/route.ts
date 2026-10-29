import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { DENIAL_STATUSES, canAccessDenials, canUpdateDenialStatus, listDenials, updateDenialStatus } from '@/lib/billing/ledger';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessDenials(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/denials')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const data = await listDenials(actorFrom(gate));
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[billing denials GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load denials' }, { status: 500 });
  }
}

const patchSchema = z.object({
  id: z.string().min(1).max(128),
  status: z.enum(DENIAL_STATUSES),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Office Manager reads the queue (GET); status changes are billing core only.
  if (!canUpdateDenialStatus(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/denials')) {
    return NextResponse.json({ success: false, error: 'Only billing staff can change a denial status' }, { status: 403 });
  }
  try {
    const body = patchSchema.parse(await req.json());
    const result = await updateDenialStatus(actorFrom(gate), body.id, body.status);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, denial: result.denial });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid denial update' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not update denial' }, { status: 400 });
  }
}
