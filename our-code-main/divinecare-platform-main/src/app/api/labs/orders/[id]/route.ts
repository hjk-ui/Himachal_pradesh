import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  LAB_ORDER_STATUSES,
  LAB_RESULT_FLAGS,
  LABS_PATH,
  canAccessLabs,
  patchOrder,
} from '@/lib/labs/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const resultSchema = z.object({
  testName: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(40).optional().nullable(),
  refRange: z.string().trim().max(80).optional().nullable(),
  flag: z.enum(LAB_RESULT_FLAGS).optional(),
});

const patchSchema = z.object({
  status: z.enum(LAB_ORDER_STATUSES).optional(),
  results: z.array(resultSchema).max(100).optional(),
  collectedAt: z.string().trim().max(40).optional().nullable(),
  resultedAt: z.string().trim().max(40).optional().nullable(),
  clinicalNotes: z.string().trim().max(4000).optional().nullable(),
});

export async function PATCH(
  req: Request,
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
    const body = patchSchema.parse(await req.json());
    const result = await patchOrder(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      id,
      body
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, order: result.order });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message || 'Invalid lab order update'
        : err instanceof Error
          ? err.message
          : 'Could not update lab order';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
