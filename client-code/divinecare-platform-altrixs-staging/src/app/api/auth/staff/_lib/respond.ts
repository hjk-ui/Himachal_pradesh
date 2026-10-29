import { NextResponse } from 'next/server';
import { DEVICE_COOKIE } from '@/lib/auth/mfaTokens';
import type { StepResult } from '@/lib/auth/staffSignIn';

/** JSON for one sign-in step; sets the "Remember this device" cookie when the step created one. */
export function respondStep(req: Request, result: StepResult): NextResponse {
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error, ...(result.locked ? { locked: true } : {}) },
      { status: result.status }
    );
  }
  const { deviceCookie, ...body } = result;
  const res = NextResponse.json({ success: true, next: body.next, ticket: body.ticket, ...(body.recoveryCodes ? { recoveryCodes: body.recoveryCodes } : {}), ...(body.remainingRecoveryCodes !== undefined ? { remainingRecoveryCodes: body.remainingRecoveryCodes } : {}) });
  res.headers.set('Cache-Control', 'no-store');
  if (deviceCookie) {
    const secure = new URL(req.url).protocol === 'https:' || process.env.NODE_ENV === 'production';
    res.cookies.set(DEVICE_COOKIE, deviceCookie.value, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/auth/staff',
      expires: deviceCookie.expires,
    });
  }
  return res;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
