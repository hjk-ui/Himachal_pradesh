import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { reviewRiskAlert } from '@/lib/alerts/manage';

export const runtime = 'nodejs';

const bodySchema = z.object({
  note: z.string().max(2000).optional().nullable(),
});

/** Legacy path — same as PATCH /api/risk-alerts/:id/review */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const result = await reviewRiskAlert({
      alertId: id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      note: body.note,
    });
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, alert: result.alert });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not update alert';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
