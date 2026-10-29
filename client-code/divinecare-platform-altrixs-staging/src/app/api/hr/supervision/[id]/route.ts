import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessSupervision, signSupervisionLog } from '@/lib/hr/supervision';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const patchSchema = z.object({
  signAs: z.enum(['supervisor', 'supervisee']),
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
    !canAccessSupervision(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/hr/supervision')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = patchSchema.parse(await req.json());
    const result = await signSupervisionLog(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      id,
      body.signAs
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, log: result.log });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid sign-off' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not sign supervision log' },
      { status: 400 }
    );
  }
}
