import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { readResetTicket } from '@/lib/auth/otp';
import { checkStaffPassword, newStaffPasswordField } from '@/lib/auth/passwordPolicy';
import { revokeTrustedDevices } from '@/lib/auth/staffSignIn';

const bodySchema = z.object({
  ticket: z.string().min(10),
  newPassword: newStaffPasswordField,
});

/**
 * Password reset step 3 (after the emailed code). Applies the staff password policy, clears the
 * password lockout, and revokes remembered devices; two-factor is still required at the next sign-in.
 */
export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const parsed = readResetTicket(body.ticket);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'Reset session expired. Request a new code.' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.email },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Reset session expired. Request a new code.' },
        { status: 400 }
      );
    }
    const policyError = checkStaffPassword(body.newPassword, { email: user.email, name: user.name });
    if (policyError) {
      return NextResponse.json({ success: false, error: policyError }, { status: 400 });
    }

    const passwordHash = await hash(body.newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, failedLoginCount: 0, loginLockedUntil: null },
    });
    await revokeTrustedDevices(user.id);

    return NextResponse.json({
      success: true,
      message: 'Password updated. You can sign in now.',
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: err.issues[0]?.message || 'Choose a different password.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Password reset failed' }, { status: 400 });
  }
}
