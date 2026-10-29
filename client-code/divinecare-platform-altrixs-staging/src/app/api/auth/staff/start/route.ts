import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startOtpSignIn, startPasswordSignIn } from '@/lib/auth/staffSignIn';
import { readJson, respondStep } from '../_lib/respond';

export const runtime = 'nodejs';

const schema = z.union([
  z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(256) }),
  z.object({ email: z.string().trim().email().max(320), otp: z.string().regex(/^\d{6}$/) }),
]);

/**
 * Staff sign-in step 1: email + password (or email + one-time code).
 * -> { next: 'mfa' | 'enroll' | 'done', ticket } ; 401 generic error ; 429 "Too many attempts. Try again in N minutes."
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Enter your work email and password.' }, { status: 400 });
  }
  const body = parsed.data;
  const result =
    'password' in body
      ? await startPasswordSignIn({ email: body.email, password: body.password, req })
      : await startOtpSignIn({ email: body.email, code: body.otp, req });
  return respondStep(req, result);
}
