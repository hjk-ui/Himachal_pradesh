import { NextResponse } from 'next/server';
import { z } from 'zod';
import { issueEmailOtp } from '@/lib/auth/otp';
import { IP_WINDOW_MS, OTP_REQUEST_LIMIT, lockMessage, minutesLeft } from '@/lib/auth/lockout';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';

const bodySchema = z.object({
  email: z.string().email(),
  purpose: z.enum(['LOGIN', 'RESET_PASSWORD']),
});

const GENERIC = 'If an account exists for this email, a verification code was sent.';

/**
 * Email one-time code (sign-in or password reset). Limits: OTP_REQUEST_LIMIT requests per 15 min
 * per IP (here, in memory) and per account (issueEmailOtp, in the DB). The account limit answers
 * with the same generic message, so the response never reveals whether the email has an account.
 */
export async function POST(req: Request) {
  const ip = rateLimit(clientKey(req, 'otp-request'), OTP_REQUEST_LIMIT, IP_WINDOW_MS);
  if (!ip.ok) {
    return NextResponse.json({ success: false, error: lockMessage(minutesLeft(ip.retryAt)) }, { status: 429 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    await issueEmailOtp(body.email, body.purpose);

    // Same message whether user exists (don't leak accounts)
    return NextResponse.json({ success: true, message: GENERIC });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Enter a valid email address.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Failed to send code' }, { status: 400 });
  }
}
