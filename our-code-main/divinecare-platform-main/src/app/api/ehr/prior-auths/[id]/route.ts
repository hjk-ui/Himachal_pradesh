import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  PRIOR_AUTH_STATUSES,
  canWritePriorAuths,
  updatePriorAuth,
} from '@/lib/ehr/priorAuths';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const patchSchema = z.object({
  payer: z.string().trim().min(1).max(120).optional(),
  authNumber: z.string().trim().max(80).optional().nullable(),
  cptCodes: z.array(z.string().trim().max(16)).min(1).max(12).optional(),
  unitsApproved: z.number().int().optional(),
  unitsUsed: z.number().int().optional(),
  useUnits: z.number().int().optional(),
  status: z.enum(PRIOR_AUTH_STATUSES).optional(),
  startDate: z.string().trim().max(40).optional().nullable(),
  endDate: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canWritePriorAuths(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/ehr/prior-auths')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = patchSchema.parse(await req.json());
    const result = await updatePriorAuth(
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
    return NextResponse.json({ success: true, auth: result.auth });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid prior auth update' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not update prior auth' },
      { status: 400 }
    );
  }
}
