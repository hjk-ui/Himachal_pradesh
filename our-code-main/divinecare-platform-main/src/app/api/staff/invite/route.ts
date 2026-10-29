import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { createStaffInvite } from '@/lib/staff/invite';
import { CLINIC_ADMIN_ROLE_VALUES } from '@/lib/platform/clinic-roles';

const roleEnum = z.enum(CLINIC_ADMIN_ROLE_VALUES);

const schema = z
  .object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    role: roleEnum.optional(),
    roles: z.array(roleEnum).min(1).optional(),
    locationId: z.string().min(1).optional().nullable(),
  })
  .refine((v) => Boolean(v.role || (v.roles && v.roles.length > 0)), {
    message: 'At least one role is required',
  });

/** Admin only: invite staff by email + role(s) */
export async function POST(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = schema.parse(await req.json());
    const roles = body.roles?.length ? body.roles : body.role ? [body.role] : [];
    const role = body.role ?? roles[0];
    const result = await createStaffInvite({
      name: body.name,
      email: body.email,
      role,
      roles,
      invitedById: gate.session.user.id,
      organizationId: gate.organizationId,
      locationId: body.locationId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      user: result.user,
      emailMode: result.emailMode,
      message:
        result.emailMode === 'smtp'
          ? 'Invitation email sent'
          : 'Invite created — email logged to server console (SMTP not configured)',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not send invite' },
      { status: 400 }
    );
  }
}
