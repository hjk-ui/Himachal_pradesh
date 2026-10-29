import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin, requireFullAdmin } from '@/lib/auth/requireAdmin';
import { listStaffUsers } from '@/lib/staff/manage';
import { assignUserToLocation } from '@/lib/org/locations';
import { getPrimaryLocationId } from '@/lib/org/ensureOrganization';
import { CLINIC_ADMIN_ROLE_VALUES } from '@/lib/platform/clinic-roles';

const createSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(CLINIC_ADMIN_ROLE_VALUES),
  locationId: z.string().cuid().optional().nullable(),
});

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const users = await listStaffUsers(gate.organizationId);
    return NextResponse.json({ success: true, users });
  } catch (err) {
    console.error('[staff GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load staff' },
      { status: 500 }
    );
  }
}

/** Direct create with password — Admin only. Prefer /api/staff/invite. */
export async function POST(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = createSchema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json(
        { success: false, error: 'A user with this email already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await hash(body.password, 12);
    const locationId =
      body.locationId || (await getPrimaryLocationId(gate.organizationId));

    const user = await prisma.user.create({
      data: {
        name: body.name.trim(),
        email,
        passwordHash,
        role: body.role,
        status: 'ACTIVE',
        organizationId: gate.organizationId,
        primaryLocationId: locationId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        image: true,
        organizationId: true,
        createdAt: true,
        primaryLocationId: true,
        primaryLocation: { select: { name: true } },
      },
    });

    if (locationId) {
      await assignUserToLocation(user.id, locationId, true, gate.organizationId);
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        image: user.image,
        organizationId: user.organizationId,
        createdAt: user.createdAt.toISOString(),
        inviteExpiresAt: null,
        primaryLocationId: user.primaryLocationId,
        primaryLocationName: user.primaryLocation?.name ?? null,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not create staff' },
      { status: 400 }
    );
  }
}
