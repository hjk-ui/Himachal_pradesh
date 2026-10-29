import { NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmEnrollment } from '@/lib/auth/staffSignIn';
import { readJson, respondStep } from '../../_lib/respond';

export const runtime = 'nodejs';

const schema = z.object({
  ticket: z.string().min(20).max(2000),
  code: z.string().trim().regex(/^\d{6}$/),
  rememberDevice: z.boolean().optional(),
});

/** Two-factor setup step 2: confirm with a 6-digit code -> 10 one-time recovery codes (shown once). */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Enter the 6-digit code from your authenticator app.' }, { status: 400 });
  }
  return respondStep(req, await confirmEnrollment({ ...parsed.data, req }));
}
