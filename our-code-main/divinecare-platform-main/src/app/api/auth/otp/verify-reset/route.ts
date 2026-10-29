import { NextResponse } from 'next/server';
import { z } from 'zod';
import { makeResetTicket, verifyEmailOtp } from '@/lib/auth/otp';

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request) {
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
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Verification failed' },
      { status: 400 }
    );
  }
}
