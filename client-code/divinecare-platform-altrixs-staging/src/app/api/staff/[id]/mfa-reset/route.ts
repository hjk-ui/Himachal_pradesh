import { NextResponse } from 'next/server';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { resetStaffMfa } from '@/lib/auth/staffSignIn';
import { invalidateSessionUser } from '@/lib/auth/requireSession';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin (ADMIN / PRACTICE_DIRECTOR): "Reset 2FA" on Users & Roles. Clears the authenticator,
 * recovery codes, 2FA lock and remembered devices; the staff member sets up 2FA again at their next
 * sign-in. Same organization only, never your own account. Audited (MFA_RESET, ids only).
 */
export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const result = await resetStaffMfa({
    targetUserId: id,
    actor: { userId: gate.userId, role: gate.role, organizationId: gate.organizationId },
    req,
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  invalidateSessionUser(id);
  return NextResponse.json({
    success: true,
    message: 'Two-factor sign-in was reset. They will set it up again the next time they sign in.',
  });
}
