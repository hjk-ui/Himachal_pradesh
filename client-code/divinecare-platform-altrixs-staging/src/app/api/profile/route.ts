import { NextResponse } from 'next/server';
import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { checkStaffPassword } from '@/lib/auth/passwordPolicy';
import { revokeTrustedDevices } from '@/lib/auth/staffSignIn';

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  phone: z
    .union([
      z.string().regex(/^\+1\d{10}$/, 'Phone must be US E.164 (+1XXXXXXXXXX)'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  npi: z
    .union([z.string().regex(/^\d{10}$/, 'NPI must be 10 digits'), z.literal('')])
    .optional(),
  licenseNumber: z.string().max(80).optional(),
  licenseExpiresAt: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])
    .optional(),
  currentPassword: z.string().min(1).optional(),
  /** Staff password policy (12-128, not common, not your name / email) is checked below */
  newPassword: z.string().min(1).max(128).optional(),
});

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  image: true,
  npi: true,
  licenseNumber: true,
  licenseExpiresAt: true,
  primaryLocationId: true,
  createdAt: true,
} as const;

function serializeUser(user: {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  image: string | null;
  npi: string | null;
  licenseNumber: string | null;
  licenseExpiresAt: Date | null;
  primaryLocationId: string | null;
  createdAt: Date;
}) {
  return {
    ...user,
    licenseExpiresAt: user.licenseExpiresAt
      ? user.licenseExpiresAt.toISOString().slice(0, 10)
      : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: profileSelect,
  });

  if (!user) {
    return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    user: serializeUser(user),
  });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = updateSchema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const emailChanging = body.email && body.email.trim().toLowerCase() !== user.email;
    const passwordChanging = Boolean(body.newPassword);

    if (emailChanging || passwordChanging) {
      if (!body.currentPassword) {
        return NextResponse.json(
          { success: false, error: 'Current password is required to change email or password' },
          { status: 400 }
        );
      }
      if (!user.passwordHash) {
        return NextResponse.json(
          { success: false, error: 'Password login is not set for this account' },
          { status: 400 }
        );
      }
      const ok = await compare(body.currentPassword, user.passwordHash);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: 'Current password is incorrect' },
          { status: 400 }
        );
      }
    }

    const data: {
      name?: string;
      email?: string;
      phone?: string | null;
      passwordHash?: string;
      npi?: string | null;
      licenseNumber?: string | null;
      licenseExpiresAt?: Date | null;
    } = {};

    if (body.name !== undefined) {
      data.name = body.name.trim();
    }

    if (body.phone !== undefined) {
      data.phone = body.phone && String(body.phone).trim() !== '' ? String(body.phone).trim() : null;
    }

    if (emailChanging && body.email) {
      const nextEmail = body.email.trim().toLowerCase();
      const taken = await prisma.user.findUnique({ where: { email: nextEmail } });
      if (taken && taken.id !== user.id) {
        return NextResponse.json(
          { success: false, error: 'That email is already in use' },
          { status: 409 }
        );
      }
      data.email = nextEmail;
    }

    if (passwordChanging && body.newPassword) {
      const policyError = checkStaffPassword(body.newPassword, {
        email: data.email ?? user.email,
        name: data.name ?? user.name,
      });
      if (policyError) {
        return NextResponse.json({ success: false, error: policyError }, { status: 400 });
      }
      data.passwordHash = await hash(body.newPassword, 12);
    }

    if (body.npi !== undefined) {
      data.npi = body.npi.trim() === '' ? null : body.npi.trim();
    }

    if (body.licenseNumber !== undefined) {
      const lic = body.licenseNumber.trim();
      data.licenseNumber = lic === '' ? null : lic;
    }

    if (body.licenseExpiresAt !== undefined) {
      if (!body.licenseExpiresAt) {
        data.licenseExpiresAt = null;
      } else {
        const d = new Date(`${body.licenseExpiresAt}T12:00:00.000Z`);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { success: false, error: 'Invalid license expiration date' },
            { status: 400 }
          );
        }
        data.licenseExpiresAt = d;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Nothing to update' },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: profileSelect,
    });
    // New password: "Remember this device" stops working everywhere (sign in with 2FA again)
    if (data.passwordHash) await revokeTrustedDevices(user.id);

    return NextResponse.json({
      success: true,
      message: 'Profile updated',
      user: serializeUser(updated),
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not update profile' },
      { status: 400 }
    );
  }
}
