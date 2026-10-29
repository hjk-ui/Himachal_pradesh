import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { changeStaffEmail } from '@/lib/staff/manage';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(254),
});

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin (ADMIN / PRACTICE_DIRECTOR): change a staff member's sign-in email. Invited users get a
 * fresh invite at the new address; active users are told at both addresses. Audited.
 */
export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const body = schema.parse(await req.json());
    const result = await changeStaffEmail(id, gate.session.user.id, gate.organizationId, body.email, {
      actorRole: gate.role,
      ...auditRequestMeta(req),
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    const message = result.invited
      ? result.inviteResent
        ? `Email updated. A new invite was sent to ${result.user.email}.`
        : 'Email updated, but the invite could not be sent. Use Resend.'
      : `Email updated. ${result.user.email} and the old address were told about the change.`;
    return NextResponse.json({ success: true, user: result.user, message });
  } catch (err: any) {
    const message =
      err instanceof z.ZodError ? err.issues[0]?.message || 'Enter a valid email address' : err.message;
    return NextResponse.json(
      { success: false, error: message || 'Could not change email' },
      { status: 400 }
    );
  }
}
