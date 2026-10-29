import { NextResponse } from 'next/server';
import { requireMfaSession, readMfaCookies } from '@/lib/mfa/gate';
import { MFA_ERRORS } from '@/lib/mfa/messages';
import {
  TRUSTED_DEVICE_COOKIE,
  isTrustedDevice,
  issueTrustedDevice,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  trustedDeviceCookieOptions,
} from '@/lib/mfa/trustedDevice';

export const runtime = 'nodejs';

/** GET — is this browser a remembered device? */
export async function GET(req: Request) {
  const g = await requireMfaSession(req, { bucket: 'device-status' });
  if (g.ok === false) return g.response;
  const { deviceToken } = await readMfaCookies(g.userId);
  return NextResponse.json({ success: true, trusted: await isTrustedDevice(g.userId, deviceToken) });
}

/** POST — remember this device for 30 days (only after this sign-in passed MFA). */
export async function POST(req: Request) {
  const g = await requireMfaSession(req, { mutation: true, bucket: 'device' });
  if (g.ok === false) return g.response;
  const { verified } = await readMfaCookies(g.userId);
  if (!verified) {
    return NextResponse.json({ success: false, error: MFA_ERRORS.verifyFirst }, { status: 403 });
  }
  const device = await issueTrustedDevice(g.userId);
  const res = NextResponse.json({ success: true, expiresAt: device.expiresAt.toISOString() });
  res.cookies.set(TRUSTED_DEVICE_COOKIE, device.token, trustedDeviceCookieOptions);
  return res;
}

/** DELETE — forget this device, or every device with ?all=true. */
export async function DELETE(req: Request) {
  const g = await requireMfaSession(req, { mutation: true, bucket: 'device' });
  if (g.ok === false) return g.response;
  const { deviceToken } = await readMfaCookies(g.userId);
  const all = new URL(req.url).searchParams.get('all') === 'true';
  const removed = all
    ? await revokeAllTrustedDevices(g.userId)
    : await revokeTrustedDevice(g.userId, deviceToken);
  const res = NextResponse.json({ success: true, removed });
  res.cookies.set(TRUSTED_DEVICE_COOKIE, '', { ...trustedDeviceCookieOptions, maxAge: 0 });
  return res;
}
