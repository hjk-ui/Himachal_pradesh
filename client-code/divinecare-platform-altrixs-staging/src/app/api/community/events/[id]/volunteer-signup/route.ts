import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessCommunity, signUpVolunteerForEvent } from '@/lib/community/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const bodySchema = z.object({
  volunteerId: z.string().min(1).max(128).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessCommunity(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const result = await signUpVolunteerForEvent(gate.organizationId, id, body.volunteerId);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      event: result.event,
      volunteer: result.volunteer,
    });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid sign-up' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not sign up' }, { status: 400 });
  }
}
