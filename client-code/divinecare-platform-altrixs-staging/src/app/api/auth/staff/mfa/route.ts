import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifySecondFactor } from '@/lib/auth/staffSignIn';
import { readJson, respondStep } from '../_lib/respond';

export const runtime = 'nodejs';

const schema = z.object({
  ticket: z.string().min(20).max(2000),
  code: z.string().trim().min(6).max(20),
  rememberDevice: z.boolean().optional(),
});

/** Staff sign-in step 2: 6-digit authenticator code or a one-time recovery code. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Enter the 6-digit code from your authenticator app.' }, { status: 400 });
  }
  return respondStep(req, await verifySecondFactor({ ...parsed.data, req }));
}
