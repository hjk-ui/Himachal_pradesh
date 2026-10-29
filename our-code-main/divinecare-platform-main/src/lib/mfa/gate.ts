import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/requireSession';
import { rejectUntrustedMutation } from '@/lib/security/request';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { MFA_ERRORS } from './messages';
import { MFA_VERIFIED_COOKIE, isVerifiedValue } from './verifiedCookie';
import { TRUSTED_DEVICE_COOKIE } from './trustedDevice';

/** /api/auth/* skips the proxy session gate, so each MFA route authenticates itself. */
export async function requireMfaSession(req: Request, opts: { mutation?: boolean; bucket: string }) {
  if (opts.mutation) {
    const rejected = rejectUntrustedMutation(req);
    if (rejected) return { ok: false as const, response: rejected };
    if (!rateLimit(clientKey(req, `mfa-${opts.bucket}`), 30, 60_000).ok) {
      return {
        ok: false as const,
        response: NextResponse.json({ success: false, error: MFA_ERRORS.locked }, { status: 429 }),
      };
    }
  }
  const gate = await requireSession();
  if (!gate.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }),
    };
  }
  return { ok: true as const, gate, userId: gate.session.user.id };
}

export async function readMfaCookies(userId: string) {
  const jar = await cookies();
  return {
    verified: isVerifiedValue(jar.get(MFA_VERIFIED_COOKIE)?.value, userId),
    deviceToken: jar.get(TRUSTED_DEVICE_COOKIE)?.value ?? null,
  };
}
