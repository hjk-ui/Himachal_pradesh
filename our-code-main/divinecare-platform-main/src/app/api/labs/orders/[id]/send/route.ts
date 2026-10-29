import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { LABS_PATH, canAccessLabs, sendOrderToClient } from '@/lib/labs/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

/** POST /api/labs/orders/[id]/send — portal message (+ notify email/SMS without result PHI). */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessLabs(gate.role) || !canAccessPath(gate.role, LABS_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const result = await sendOrderToClient(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      id
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({
      success: true,
      order: result.order,
      threadId: result.threadId,
      channels: result.channels,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not send lab results to client';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
