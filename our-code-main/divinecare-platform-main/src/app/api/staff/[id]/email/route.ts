import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { changeStaffSignInEmail } from '@/lib/staff/manage';
import { resendStaffInvite } from '@/lib/staff/invite';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string().min(3).max(200),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Enter a valid email address' }, { status: 400 });
  }

  const result = await changeStaffSignInEmail(
    id,
    gate.userId,
    gate.organizationId,
    parsed.data.email
  );
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  let emailMode: string | undefined;
  if (result.resendInvite) {
    const resent = await resendStaffInvite(id, gate.userId, gate.organizationId);
    if (!resent.ok) {
      return NextResponse.json(
        {
          success: true,
          user: result.user,
          warning: resent.error,
          previousEmail: result.previousEmail,
        },
        { status: 200 }
      );
    }
    emailMode = resent.emailMode;
  }

  return NextResponse.json({
    success: true,
    user: result.user,
    previousEmail: result.previousEmail,
    resendInvite: result.resendInvite,
    emailMode,
  });
}
