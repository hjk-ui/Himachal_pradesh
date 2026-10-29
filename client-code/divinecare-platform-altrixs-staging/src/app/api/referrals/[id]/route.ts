import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessReferrals, referralVisibleTo, updateReferral } from '@/lib/referrals/manage';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const patchSchema = z.object({
  status: z.enum(['pending', 'accepted', 'converted', 'declined']).optional(),
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
  if (!canAccessReferrals(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = patchSchema.parse(await req.json());
    // Peer Support / Case Manager: only referrals visible to them in the list
    if (!(await referralVisibleTo(gate.organizationId, id, { userId: gate.userId, role: gate.role }))) {
      return NextResponse.json({ success: false, error: 'Referral not found' }, { status: 404 });
    }
    const result = await updateReferral(gate.organizationId, id, body);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, referral: result.referral });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? 'Invalid referral update'
        : err instanceof Error
          ? err.message
          : 'Could not update referral';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
