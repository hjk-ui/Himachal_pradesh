import { NextResponse } from 'next/server';
import { z } from 'zod';
import { issueEmailOtp } from '@/lib/auth/otp';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { rejectUntrustedMutation } from '@/lib/security/request';

const bodySchema = z.object({
  email: z.string().email(),
  purpose: z.enum(['LOGIN', 'RESET_PASSWORD']),
});

export async function POST(req: Request) {
  const rejected = rejectUntrustedMutation(req);
  if (rejected) return rejected;
  if (!rateLimit(clientKey(req, 'otp-request'), 20, 60_000).ok) {
    return NextResponse.json({ success: false, error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    await issueEmailOtp(body.email, body.purpose);

    // Same message whether user exists (don't leak accounts)
    return NextResponse.json({
      success: true,
      message: 'If an account exists for this email, a verification code was sent.',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to send code' },
      { status: 400 }
    );
  }
}
