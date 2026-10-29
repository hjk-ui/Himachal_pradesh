import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMfaSession } from '@/lib/mfa/gate';
import { MFA_ERRORS } from '@/lib/mfa/messages';
import { verifyRecoveryCode } from '@/lib/mfa/service';
import {
  MFA_VERIFIED_COOKIE,
  issueVerifiedValue,
  verifiedCookieOptions,
} from '@/lib/mfa/verifiedCookie';
import {
  TRUSTED_DEVICE_COOKIE,
  issueTrustedDevice,
  trustedDeviceCookieOptions,
} from '@/lib/mfa/trustedDevice';

export const runtime = 'nodejs';

const bodySchema = z.object({
  code: z.string().min(8).max(32),
  remember: z.boolean().optional(),
});

/** POST { code, remember? } — single-use recovery code in place of an authenticator code. */
export async function POST(req: Request) {
  const g = await requireMfaSession(req, { mutation: true, bucket: 'recovery' });
  if (g.ok === false) return g.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: MFA_ERRORS.invalidRecovery }, { status: 400 });
  }

  const result = await verifyRecoveryCode(g.userId, parsed.data.code);
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  const res = NextResponse.json({ success: true, recoveryCodesLeft: result.recoveryCodesLeft });
  res.cookies.set(MFA_VERIFIED_COOKIE, issueVerifiedValue(g.userId), verifiedCookieOptions);
  if (parsed.data.remember) {
    const device = await issueTrustedDevice(g.userId);
    res.cookies.set(TRUSTED_DEVICE_COOKIE, device.token, trustedDeviceCookieOptions);
  }
  return res;
}
