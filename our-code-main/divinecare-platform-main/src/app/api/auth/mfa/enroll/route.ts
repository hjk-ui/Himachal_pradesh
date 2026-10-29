import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { rejectUntrustedMutation } from '@/lib/security/request';
import { requireMfaSession } from '@/lib/mfa/gate';
import { MFA_ERRORS } from '@/lib/mfa/messages';
import { confirmEnrollment, loadMfaUser, resetMfa, startEnrollment } from '@/lib/mfa/service';
import {
  MFA_VERIFIED_COOKIE,
  issueVerifiedValue,
  verifiedCookieOptions,
} from '@/lib/mfa/verifiedCookie';

export const runtime = 'nodejs';

const confirmSchema = z.object({ code: z.string().regex(/^\d{6}$/, MFA_ERRORS.invalidCode).optional() });
const resetSchema = z.object({ userId: z.string().min(1) });

/** GET — is MFA on for the signed-in user? */
export async function GET(req: Request) {
  const g = await requireMfaSession(req, { bucket: 'enroll-status' });
  if (g.ok === false) return g.response;
  const user = await loadMfaUser(g.userId);
  return NextResponse.json({ success: true, enrolled: Boolean(user?.mfaEnabled) });
}

/**
 * POST {}          → start enrollment, returns { secret, otpauthUri }
 * POST { code }    → confirm enrollment, returns one-time { recoveryCodes }
 */
export async function POST(req: Request) {
  const g = await requireMfaSession(req, { mutation: true, bucket: 'enroll' });
  if (g.ok === false) return g.response;

  const parsed = confirmSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || MFA_ERRORS.invalidCode },
      { status: 400 }
    );
  }

  if (!parsed.data.code) {
    const started = await startEnrollment(g.userId);
    if (started.ok === false) {
      return NextResponse.json({ success: false, error: started.error }, { status: started.status });
    }
    return NextResponse.json({
      success: true,
      secret: started.secret,
      otpauthUri: started.otpauthUri,
    });
  }

  const confirmed = await confirmEnrollment(g.userId, parsed.data.code);
  if (confirmed.ok === false) {
    return NextResponse.json({ success: false, error: confirmed.error }, { status: confirmed.status });
  }
  const res = NextResponse.json({ success: true, recoveryCodes: confirmed.recoveryCodes });
  res.cookies.set(MFA_VERIFIED_COOKIE, issueVerifiedValue(g.userId), verifiedCookieOptions);
  return res;
}

/** DELETE { userId } — Admin "Reset 2FA" for a staff member in the same clinic. */
export async function DELETE(req: Request) {
  const rejected = rejectUntrustedMutation(req);
  if (rejected) return rejected;

  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const baseRole = (gate.session.user.baseRole as string | undefined) ?? gate.role;
  if (baseRole !== 'ADMIN' && baseRole !== 'PRACTICE_DIRECTOR') {
    return NextResponse.json({ success: false, error: MFA_ERRORS.forbidden }, { status: 403 });
  }

  const parsed = resetSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: MFA_ERRORS.userNotFound }, { status: 400 });
  }

  const target = await prisma.user.findFirst({
    where: { id: parsed.data.userId, organizationId: gate.organizationId },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ success: false, error: MFA_ERRORS.userNotFound }, { status: 404 });
  }

  await resetMfa(target.id);
  return NextResponse.json({ success: true });
}
