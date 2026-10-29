import { NextResponse } from 'next/server';
import { z } from 'zod';
import { beginEnrollment } from '@/lib/auth/staffSignIn';
import { readJson } from '../_lib/respond';

export const runtime = 'nodejs';

const schema = z.object({ ticket: z.string().min(20).max(2000) });

/** Two-factor setup step 1: QR code (server-rendered SVG data URL) + manual key for the authenticator app. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Your sign-in expired. Start again.' }, { status: 400 });
  }
  const result = await beginEnrollment({ ticket: parsed.data.ticket, req });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  const res = NextResponse.json({
    success: true,
    qr: result.qr,
    manualKey: result.manualKey,
    otpauthUri: result.otpauthUri,
    account: result.account,
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
