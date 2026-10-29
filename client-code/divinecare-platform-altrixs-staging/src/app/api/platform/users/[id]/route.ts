import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/tenant';
import { updatePlatformUser } from '@/lib/platform/manage';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

const patchSchema = z
  .object({
    role: z
      .enum([
        'ADMIN',
        'DIRECTOR',
        'CLINICIAN',
        'THERAPIST',
        'PSYCHIATRIST',
        'NP',
        'PRP_SPECIALIST',
        'CASE_MANAGER',
        'PEER_SUPPORT',
        'FRONT_DESK',
        'BILLING',
        'HR',
      ])
      .optional(),
    status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
    organizationId: z.string().cuid().optional().nullable(),
  })
  .refine(
    (v) =>
      v.role !== undefined || v.status !== undefined || v.organizationId !== undefined,
    { message: 'Nothing to update' }
  );

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());
    const result = await updatePlatformUser(id, body, {
      actorUserId: gate.session.user.id,
      actorRole: gate.role,
      ...auditRequestMeta(req),
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, user: result.user });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not update user' },
      { status: 400 }
    );
  }
}
