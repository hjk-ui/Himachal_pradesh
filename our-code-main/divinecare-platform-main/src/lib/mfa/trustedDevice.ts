import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { MFA_TRUSTED_DEVICE_DAYS } from './messages';

/** Remember-this-device: random token in an httpOnly cookie, SHA-256 of it in MfaTrustedDevice. */
export const TRUSTED_DEVICE_COOKIE = 'dc-mfa-device';
const DAY_MS = 24 * 60 * 60 * 1000;

export const trustedDeviceCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: MFA_TRUSTED_DEVICE_DAYS * 24 * 60 * 60,
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueTrustedDevice(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + MFA_TRUSTED_DEVICE_DAYS * DAY_MS);
  await prisma.mfaTrustedDevice.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  // Opportunistic cleanup keeps the table small without a cron.
  await prisma.mfaTrustedDevice.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  return { token, expiresAt };
}

export async function isTrustedDevice(userId: string, token: string | undefined | null) {
  if (!token) return false;
  const row = await prisma.mfaTrustedDevice.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!row || row.userId !== userId || row.expiresAt <= new Date()) return false;
  await prisma.mfaTrustedDevice.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return true;
}

export async function revokeTrustedDevice(userId: string, token: string | undefined | null) {
  if (!token) return 0;
  const res = await prisma.mfaTrustedDevice.deleteMany({
    where: { userId, tokenHash: hashToken(token) },
  });
  return res.count;
}

export async function revokeAllTrustedDevices(userId: string) {
  const res = await prisma.mfaTrustedDevice.deleteMany({ where: { userId } });
  return res.count;
}
