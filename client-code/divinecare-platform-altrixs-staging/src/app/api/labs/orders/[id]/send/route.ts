import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { sendOrderToClient } from '@/lib/labs/manage';
import { labError, labGate } from '@/lib/labs/routeGate';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

/**
 * POST /api/labs/orders/[id]/send — release reviewed results to the patient portal (portal message
 * + notify email/SMS without result PHI). Requires provider review first. Prescribers only.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await labGate(req, 'release');
  if (g.denied) return g.denied;
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const result = await sendOrderToClient(g.actor, id);
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate: g.gate, req, action: 'UPDATE', resourceType: 'labOrder', resourceId: result.order.id, patientId: result.order.clientId,
      metadata: { event: 'lab_portal_release', threadId: result.threadId, channels: result.channels },
    });
    return NextResponse.json({
      success: true,
      order: result.order,
      threadId: result.threadId,
      channels: result.channels,
    });
  } catch (err) {
    return labError(err, 'labs/orders/[id]/send POST', 'Could not release lab results to the client');
  }
}
