import { NextResponse } from 'next/server';
import { z } from 'zod';
import { acceptStaffInvite, getInviteByToken } from '@/lib/staff/invite';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';

const getSchema = z.object({
  token: z.string().min(20).max(200),
});

const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(72),
});

function tooMany(req: Request, bucket: string) {
  const limited = rateLimit(clientKey(req, bucket), 15, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Try again later.' },
      { status: 429 }
    );
  }
  return null;
}

/** Public: preview invite details */
export async function GET(req: Request) {
  const blocked = tooMany(req, 'staff-invite-preview');
  if (blocked) return blocked;

  const token = new URL(req.url).searchParams.get('token') || '';
  const parsed = getSchema.safeParse({ token });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid invite link' }, { status: 400 });
  }

  const result = await getInviteByToken(parsed.data.token);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, invite: result.invite });
}

/** Public: set password and activate account */
export async function POST(req: Request) {
  try {
    const blocked = tooMany(req, 'staff-invite-accept');
    if (blocked) return blocked;

    const body = acceptSchema.parse(await req.json());
    const result = await acceptStaffInvite(body.token, body.password);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      user: result.user,
      message: 'Account activated. You can sign in now.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not accept invite' },
      { status: 400 }
    );
  }
}
