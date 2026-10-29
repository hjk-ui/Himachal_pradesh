import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import {
  backfillUsersToDefaultOrg,
  ensureDefaultOrganization,
  getPrimaryLocationId,
} from '@/lib/org/ensureOrganization';
import { assignUserToLocation } from '@/lib/org/locations';
import { rejectUntrustedMutation } from '@/lib/security/request';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { STAFF_PASSWORD_MAX_LENGTH, validateStaffPassword } from '@/lib/security/passwordPolicy';

const bodySchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().max(STAFF_PASSWORD_MAX_LENGTH),
});

/**
 * One-time bootstrap: create the first clinic ADMIN when no clinic users exist.
 * SUPER_ADMIN accounts do not count (platform bootstrap is separate).
 */
export async function GET() {
  try {
    await backfillUsersToDefaultOrg();
    const clinicUsers = await prisma.user.count({
      where: { role: { not: 'SUPER_ADMIN' } },
    });
    return NextResponse.json({
      success: true,
      needsSetup: clinicUsers === 0,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'We could not connect to the authentication service. Please try again in a moment.',
      },
      { status: 503 }
    );
  }
}

export async function POST(req: Request) {
  const rejected = rejectUntrustedMutation(req);
  if (rejected) return rejected;
  if (!rateLimit(clientKey(req, 'auth-setup'), 20, 60_000).ok) {
    return NextResponse.json({ success: false, error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }
  try {
    await backfillUsersToDefaultOrg();
    const clinicUsers = await prisma.user.count({
      where: { role: { not: 'SUPER_ADMIN' } },
    });
    if (clinicUsers > 0) {
      return NextResponse.json(
        { success: false, error: 'Setup already completed. Ask an admin to create users.' },
        { status: 403 }
      );
    }

    const body = bodySchema.parse(await req.json());
    const email = body.email.trim().toLowerCase();
    const passwordCheck = validateStaffPassword(body.password, { name: body.name, email });
    if (passwordCheck.ok === false) {
      return NextResponse.json({ success: false, error: passwordCheck.error }, { status: 400 });
    }
    const passwordHash = await hash(body.password, 12);

    const org = await ensureDefaultOrganization();
    const locationId = await getPrimaryLocationId(org.id);

    const user = await prisma.user.create({
      data: {
        name: body.name.trim(),
        email,
        passwordHash,
        role: 'ADMIN',
        organizationId: org.id,
        primaryLocationId: locationId,
      },
      select: { id: true, email: true, name: true, role: true, organizationId: true },
    });

    if (locationId) {
      await assignUserToLocation(user.id, locationId, true, org.id);
    }

    return NextResponse.json({
      success: true,
      message: 'Admin account created. You can sign in now.',
      user,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof z.ZodError ? 'Invalid setup details' : 'Setup failed' },
      { status: 400 }
    );
  }
}
