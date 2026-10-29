import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { reviewRiskAlert } from '@/lib/alerts/manage';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';

export const runtime = 'nodejs';

const bodySchema = z.object({
  note: z.string().max(2000).optional().nullable(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessPath(gate.role, '/dashboard/alerts', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
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
    invalidateInboxForOrg(gate.organizationId);
    return NextResponse.json({ success: true, alert: result.alert });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not review alert';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
