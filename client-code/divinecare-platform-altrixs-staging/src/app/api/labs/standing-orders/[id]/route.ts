import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { updateStandingOrder } from '@/lib/labs/standingDb';
import { labError, labGate } from '@/lib/labs/routeGate';

export const runtime = 'nodejs';

const patchSchema = z.object({
  active: z.boolean().optional(),
  nextDueAt: z.string().trim().max(40).optional().nullable(),
  endDate: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

/** PATCH /api/labs/standing-orders/[id] — stop, reschedule or annotate (prescribers only) */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await labGate(req, 'order', 'labStandingOrder');
  if (g.denied) return g.denied;
  try {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());
    const result = await updateStandingOrder(g.actor, id, body);
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    await auditPhiAccess({
      gate: g.gate, req, action: 'UPDATE', resourceType: 'labStandingOrder', resourceId: id, patientId: result.standing.clientId,
      metadata: { fields: Object.keys(body) },
    });
    return NextResponse.json({ success: true, standing: result.standing });
  } catch (err) {
    return labError(err, 'labs/standing-orders/[id] PATCH', 'Could not update the standing order');
  }
}
