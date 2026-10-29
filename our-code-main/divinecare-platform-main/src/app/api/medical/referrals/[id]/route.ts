import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { patchReferralStatus } from '@/lib/medical/referrals';

export const runtime = 'nodejs';

const ROLES = new Set([
  'PHYSICIAN',
  'MEDICAL_NP',
  'MEDICAL_ASSISTANT',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(['sent', 'scheduled', 'seen', 'report_received', 'cancelled']),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid referral status' }, { status: 400 });
  }
  const result = await patchReferralStatus(gate.organizationId, id, parsed.data.status);
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, referral: result.referral });
}
