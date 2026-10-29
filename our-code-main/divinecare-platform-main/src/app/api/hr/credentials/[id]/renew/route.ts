import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canMutateCredentials, markCredentialRenewed } from '@/lib/hr/credentials';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const bodySchema = z.object({
  expiresAt: z.string().trim().min(8).max(40).optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canMutateCredentials(gate.role) ||
    !canAccessPath(gate.role, '/dashboard/hr/credentialing')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const result = await markCredentialRenewed(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      id,
      body.expiresAt || undefined
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, credential: result.credential });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid renewal' : (err as Error).message;
    return NextResponse.json(
      { success: false, error: message || 'Could not renew credential' },
      { status: 400 }
    );
  }
}
