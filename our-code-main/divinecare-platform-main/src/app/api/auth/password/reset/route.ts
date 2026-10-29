import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { readResetTicket } from '@/lib/auth/otp';
import { rejectUntrustedMutation } from '@/lib/security/request';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { STAFF_PASSWORD_MAX_LENGTH, validateStaffPassword } from '@/lib/security/passwordPolicy';

const bodySchema = z.object({
  ticket: z.string().min(10),
  newPassword: z.string().max(STAFF_PASSWORD_MAX_LENGTH),
});

export async function POST(req: Request) {
  const rejected = rejectUntrustedMutation(req);
  if (rejected) return rejected;
  if (!rateLimit(clientKey(req, 'staff-password-reset'), 20, 60_000).ok) {
    return NextResponse.json({ success: false, error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    const parsed = readResetTicket(body.ticket);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'Reset session expired. Request a new code.' },
        { status: 400 }
      );
    }

    const account = await prisma.user.findUnique({
      where: { email: parsed.email },
      select: { name: true },
    });
    const passwordCheck = validateStaffPassword(body.newPassword, {
      name: account?.name,
      email: parsed.email,
    });
    if (passwordCheck.ok === false) {
      return NextResponse.json({ success: false, error: passwordCheck.error }, { status: 400 });
    }

    const passwordHash = await hash(body.newPassword, 12);
    await prisma.user.update({
      where: { email: parsed.email },
      data: { passwordHash },
    });

    return NextResponse.json({
      success: true,
      message: 'Password updated. You can sign in now.',
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof z.ZodError ? 'Invalid password reset request' : 'Password reset failed' },
      { status: 400 }
    );
  }
}
