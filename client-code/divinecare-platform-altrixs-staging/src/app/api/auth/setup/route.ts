import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ensureDefaultOrganization, getPrimaryLocationId } from '@/lib/org/ensureOrganization';
import { assignUserToLocation } from '@/lib/org/locations';
import { checkStaffPassword, newStaffPasswordField } from '@/lib/auth/passwordPolicy';

const bodySchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: newStaffPasswordField,
});

/**
 * One-time bootstrap: create the first clinic ADMIN when no clinic users exist.
 * SUPER_ADMIN accounts do not count (platform bootstrap is separate).
 *
 * GET is public (the login page calls it on every load) and strictly read-only. Attaching users
 * without an organization to the default org is a one-off: scripts/backfill-default-org.ts.
 */
export async function GET() {
  try {
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
  try {
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
    const policyError = checkStaffPassword(body.password, { email, name: body.name });
    if (policyError) {
      return NextResponse.json({ success: false, error: policyError }, { status: 400 });
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
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: err.issues[0]?.message || 'Check the form and try again.' }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: err.message || 'Setup failed' },
      { status: 400 }
    );
  }
}
