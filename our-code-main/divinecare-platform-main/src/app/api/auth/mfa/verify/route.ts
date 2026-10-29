import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMfaSession, readMfaCookies } from '@/lib/mfa/gate';
import { MFA_ERRORS } from '@/lib/mfa/messages';
import { loadMfaUser, verifyAuthenticatorCode } from '@/lib/mfa/service';
import { getPracticeSecurity, isMfaEnforcedByEnv } from '@/lib/mfa/practiceSetting';
import {
  MFA_VERIFIED_COOKIE,
  issueVerifiedValue,
  verifiedCookieOptions,
} from '@/lib/mfa/verifiedCookie';
import {
  TRUSTED_DEVICE_COOKIE,
  isTrustedDevice,
  issueTrustedDevice,
  trustedDeviceCookieOptions,
} from '@/lib/mfa/trustedDevice';

export const runtime = 'nodejs';

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/, MFA_ERRORS.invalidCode),
  remember: z.boolean().optional(),
});

/**
 * GET — what should the login screen do after the password step?
 *   challenge:      user has MFA on and this sign-in has not passed it yet
 *   enrollRequired: practice requires MFA, enforcement is on, user has not enrolled
 */
export async function GET(req: Request) {
  const g = await requireMfaSession(req, { bucket: 'verify-status' });
  if (g.ok === false) return g.response;

  const user = await loadMfaUser(g.userId);
  const enrolled = Boolean(user?.mfaEnabled);
  const cookies = await readMfaCookies(g.userId);

  let verified = cookies.verified;
  let trustedByDevice = false;
  if (enrolled && !verified && (await isTrustedDevice(g.userId, cookies.deviceToken))) {
    verified = true;
    trustedByDevice = true;
  }

  let enrollRequired = false;
  if (!enrolled && isMfaEnforcedByEnv() && g.gate.organizationId) {
    enrollRequired = (await getPracticeSecurity(g.gate.organizationId)).mfaRequired;
  }

  const res = NextResponse.json({
    success: true,
    enrolled,
    verified,
    challenge: enrolled && !verified,
    enrollRequired,
  });
  if (trustedByDevice) {
    res.cookies.set(MFA_VERIFIED_COOKIE, issueVerifiedValue(g.userId), verifiedCookieOptions);
  }
  return res;
}

/** POST { code, remember? } — authenticator code challenge. */
export async function POST(req: Request) {
  const g = await requireMfaSession(req, { mutation: true, bucket: 'verify' });
  if (g.ok === false) return g.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: MFA_ERRORS.invalidCode }, { status: 400 });
  }

  const result = await verifyAuthenticatorCode(g.userId, parsed.data.code);
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(MFA_VERIFIED_COOKIE, issueVerifiedValue(g.userId), verifiedCookieOptions);
  if (parsed.data.remember) {
    const device = await issueTrustedDevice(g.userId);
    res.cookies.set(TRUSTED_DEVICE_COOKIE, device.token, trustedDeviceCookieOptions);
  }
  return res;
}
