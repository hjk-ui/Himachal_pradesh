import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { updateStaffUser } from '@/lib/staff/manage';
import { CLINIC_ADMIN_ROLE_VALUES } from '@/lib/platform/clinic-roles';

const roleEnum = z.enum(CLINIC_ADMIN_ROLE_VALUES);

const patchSchema = z
  .object({
    role: roleEnum.optional(),
    roles: z.array(roleEnum).min(1).optional(),
    status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
    locationId: z.string().min(1).nullable().optional(),
    email: z.string().trim().email().max(320).optional(),
  })
  .refine(
    (v) =>
      v.role !== undefined ||
      v.roles !== undefined ||
      v.status !== undefined ||
      v.locationId !== undefined ||
      v.email !== undefined,
    { message: 'Nothing to update' }
  );

type Ctx = { params: Promise<{ id: string }> };

/** Admin: deactivate / activate / reassign role(s) or location */
export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());
    const result = await updateStaffUser(
      id,
      gate.session.user.id,
      gate.organizationId,
      body
    );

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      user: result.user,
      message: 'Staff updated',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not update staff' },
      { status: 400 }
    );
  }
}
