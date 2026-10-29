import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { patchTelehealthSession } from '@/lib/telehealth/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const patchSchema = z.object({
  status: z.enum(['upcoming', 'in_progress', 'completed', 'cancelled']).optional().nullable(),
  notesSummary: z.string().max(4000).optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const result = await patchTelehealthSession({
      id,
      organizationId: gate.organizationId,
      actorRole: gate.role,
      actorUserId: gate.userId,
      ...body,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, session: result.session });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not update session';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
