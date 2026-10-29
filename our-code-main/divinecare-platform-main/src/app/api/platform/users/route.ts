import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/tenant';
import { createPlatformUser, listPlatformUsers } from '@/lib/platform/manage';
import { CLINIC_ADMIN_ROLE_VALUES } from '@/lib/platform/clinic-roles';

const createSchema = z.object({
  organizationId: z.string().cuid(),
  name: z.string().min(2).max(100),
  email: z.string().email(),
  role: z.enum(CLINIC_ADMIN_ROLE_VALUES),
  password: z.string().min(8).max(128).optional().nullable(),
});

export async function GET(req: Request) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const url = new URL(req.url);
    const organizationId = url.searchParams.get('organizationId');
    const q = url.searchParams.get('q');
    const role = url.searchParams.get('role');
    const users = await listPlatformUsers({
      organizationId: organizationId || null,
      q,
      role: role || null,
    });
    return NextResponse.json({ success: true, users });
  } catch (err) {
    console.error('[platform/users GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load users' },
      { status: 500 }
    );
  }
}

/** Super Admin: create clinic user (password) or invite (no password). */
export async function POST(req: Request) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createPlatformUser({
      organizationId: body.organizationId,
      name: body.name,
      email: body.email,
      role: body.role,
      password: body.password,
      invitedById: gate.userId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(
      {
        success: true,
        mode: result.mode,
        emailMode: result.mode === 'invite' ? result.emailMode : undefined,
        user: result.user,
        message:
          result.mode === 'password'
            ? 'User created and can sign in now'
            : 'Invite sent (or logged to console if SMTP not set)',
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not create user' },
      { status: 400 }
    );
  }
}
