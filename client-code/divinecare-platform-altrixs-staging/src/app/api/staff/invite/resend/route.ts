import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { resendStaffInvite } from '@/lib/staff/invite';

const schema = z.object({
  userId: z.string().min(1),
});

export async function POST(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = schema.parse(await req.json());
    const result = await resendStaffInvite(
      body.userId,
      gate.session.user.id,
      gate.organizationId
    );

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      user: result.user,
      emailMode: result.emailMode,
      message:
        result.emailMode !== 'console'
          ? 'Invitation resent'
          : 'Invite resent — email logged to server console',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not resend invite' },
      { status: 400 }
    );
  }
}
