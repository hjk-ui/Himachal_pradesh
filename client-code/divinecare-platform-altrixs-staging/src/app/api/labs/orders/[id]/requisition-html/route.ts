import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getOrder } from '@/lib/labs/manage';
import { requisitionHtmlFor } from '@/lib/labs/requisitionData';
import { labError, labGate } from '@/lib/labs/routeGate';

export const runtime = 'nodejs';

/**
 * GET /api/labs/orders/[id]/requisition-html[?format=raw] — printable requisition. Same role,
 * org, caseload / care-team and Part 2 scope as the order itself.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await labGate(req, 'view', 'labRequisition');
  if (g.denied) return g.denied;
  try {
    const { id } = await ctx.params;
    const order = await getOrder(g.actor, id);
    if (!order) {
      return NextResponse.json({ success: false, error: 'Lab order not found' }, { status: 404 });
    }
    const html = await requisitionHtmlFor(order);
    const raw = new URL(req.url).searchParams.get('format') === 'raw';
    await auditPhiAccess({
      gate: g.gate, req, action: 'EXPORT', resourceType: 'labRequisition', resourceId: order.id, patientId: order.clientId,
      metadata: { format: raw ? 'html' : 'json' },
    });
    if (raw) {
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
    }
    return NextResponse.json({ success: true, html, order });
  } catch (err) {
    return labError(err, 'labs/requisition-html GET', 'Error generating requisition');
  }
}
