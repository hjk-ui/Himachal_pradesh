import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { updateStaffUser } from '@/lib/staff/manage';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { CLINIC_ADMIN_ROLE_VALUES } from '@/lib/platform/clinic-roles';
import { syncSeatsInBackground } from '@/lib/stripe/checkout';

const roleEnum = z.enum(CLINIC_ADMIN_ROLE_VALUES);

const patchSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100).optional(),
    role: roleEnum.optional(),
    roles: z.array(roleEnum).min(1).optional(),
    status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
    locationId: z.string().min(1).nullable().optional(),
    rcopiaUsername: z.string().trim().max(64).regex(/^[A-Za-z0-9._@-]*$/, 'Invalid DrFirst username').nullable().optional(),
    // Medical Director designation (prescriber roles only; validated in updateStaffUser)
    isMedicalDirector: z.boolean().optional(),
    medicalDirectorScope: z.string().trim().max(200).nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.role !== undefined ||
      v.roles !== undefined ||
      v.status !== undefined ||
      v.locationId !== undefined ||
      v.rcopiaUsername !== undefined ||
      v.isMedicalDirector !== undefined ||
      v.medicalDirectorScope !== undefined,
    { message: 'Nothing to update' }
  );

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin (ADMIN / PRACTICE_DIRECTOR): edit the display name, deactivate / activate / reassign role(s),
 * location, DrFirst username, or the Medical Director designation (audited, session cache invalidated, never self).
 */
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
      body,
      { actorRole: gate.role, ...auditRequestMeta(req) }
    );

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    if (body.status !== undefined || body.role !== undefined || body.roles !== undefined) {
      syncSeatsInBackground(gate.organizationId); // no-op unless BILLING_SEAT_SYNC=true
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
