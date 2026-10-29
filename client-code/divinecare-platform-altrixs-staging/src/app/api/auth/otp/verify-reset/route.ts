import { NextResponse } from 'next/server';
import { z } from 'zod';
import { makeResetTicket, verifyEmailOtp } from '@/lib/auth/otp';
import { IP_LOGIN_LIMIT, IP_WINDOW_MS, lockMessage, minutesLeft } from '@/lib/auth/lockout';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

/** Password reset step 2: the emailed code (void after 5 wrong guesses) -> short-lived reset ticket. */
export async function POST(req: Request) {
  const ip = rateLimit(clientKey(req, 'otp-verify'), IP_LOGIN_LIMIT, IP_WINDOW_MS);
  if (!ip.ok) {
    return NextResponse.json({ success: false, error: lockMessage(minutesLeft(ip.retryAt)) }, { status: 429 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    const verified = await verifyEmailOtp(body.email, body.code, 'RESET_PASSWORD');

    if (!verified.ok) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired code' },
        { status: 400 }
      );
    }

    const ticket = makeResetTicket(verified.email);
    return NextResponse.json({ success: true, ticket });
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid or expired code' }, { status: 400 });
  }
}
