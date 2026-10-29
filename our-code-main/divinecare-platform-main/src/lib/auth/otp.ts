import { createHash, randomInt } from 'crypto';
import { hash, compare } from 'bcryptjs';
import type { OtpPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/mail/sendEmail';
import { getAuthSecret } from '@/lib/security/secrets';

const OTP_TTL_MS = 2 * 60 * 1000; // 2 minutes
const OTP_LENGTH = 6;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0');
}

function ticketSignature(email: string, exp: number) {
  const secret = getAuthSecret();
  return createHash('sha256').update(`${email}:${exp}:${secret}`).digest('hex').slice(0, 32);
}

export async function issueEmailOtp(emailRaw: string, purpose: OtpPurpose) {
  const email = normalizeEmail(emailRaw);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { sent: false as const, reason: 'no_user' as const };
  }

  await prisma.emailOtp.updateMany({
    where: { email, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateCode();
  const codeHash = await hash(code, 10);

  await prisma.emailOtp.create({
    data: {
      email,
      codeHash,
      purpose,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  const purposeLabel = purpose === 'LOGIN' ? 'login' : 'password reset';
  await sendEmail({
    to: email,
    subject: `Altrixs verification code (${purposeLabel})`,
    text: `Your Altrixs verification code is: ${code}\n\nThis code expires in 2 minutes.\nIf you did not request this, ignore this email.`,
    html: `<p>Your Altrixs verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in 2 minutes.</p>`,
    context: purpose === 'LOGIN' ? 'otp-login' : 'otp-reset',
  });

  return { sent: true as const, email };
}

export async function verifyEmailOtp(
  emailRaw: string,
  codeRaw: string,
  purpose: OtpPurpose
) {
  const email = normalizeEmail(emailRaw);
  const code = codeRaw.trim();

  if (!/^\d{6}$/.test(code)) {
    return { ok: false as const, error: 'invalid_format' as const };
  }

  const latest = await prisma.emailOtp.findFirst({
    where: {
      email,
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!latest) {
    return { ok: false as const, error: 'expired_or_missing' as const };
  }

  const match = await compare(code, latest.codeHash);
  if (!match) {
    return { ok: false as const, error: 'mismatch' as const };
  }

  await prisma.emailOtp.update({
    where: { id: latest.id },
    data: { consumedAt: new Date() },
  });

  return { ok: true as const, email };
}

/** Short-lived proof that OTP was verified (password reset step 2 → 3) */
export function makeResetTicket(email: string) {
  const exp = Date.now() + 15 * 60 * 1000;
  const sig = ticketSignature(email, exp);
  return Buffer.from(`${email}:${exp}:${sig}`).toString('base64url');
}

export function readResetTicket(ticket: string): { email: string } | null {
  try {
    const raw = Buffer.from(ticket, 'base64url').toString('utf8');
    const [email, expStr, sig] = raw.split(':');
    const exp = Number(expStr);
    if (!email || !exp || !sig || Date.now() > exp) return null;
    if (sig !== ticketSignature(email, exp)) return null;
    return { email };
  } catch {
    return null;
  }
}
