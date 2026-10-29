import { NextResponse } from 'next/server';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { reviewOrder } from '@/lib/labs/manage';
import { labError, labGate } from '@/lib/labs/routeGate';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const bodySchema = z.object({ note: z.string().trim().max(2000).optional().nullable() });

/** POST /api/labs/orders/[id]/review — provider sign-off of results (prescribers only) */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await labGate(req, 'review');
  if (g.denied) return g.denied;
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const result = await reviewOrder(g.actor, id, body);
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    await auditPhiAccess({
      gate: g.gate, req, action: 'UPDATE', resourceType: 'labOrder', resourceId: result.order.id, patientId: result.order.clientId,
      metadata: { event: 'lab_review_signoff', critical: result.order.hasCritical, noted: Boolean(body.note) },
    });
    invalidateInboxForOrg(g.gate.organizationId);
    return NextResponse.json({ success: true, order: result.order });
  } catch (err) {
    return labError(err, 'labs/orders/[id]/review POST', 'Could not sign off the results');
  }
}
