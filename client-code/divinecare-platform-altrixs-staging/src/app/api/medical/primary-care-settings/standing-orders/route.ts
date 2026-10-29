import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canViewPrimaryCareWorkflow } from '@/lib/medical/primaryCareWorkflow';
import { actOnStandingOrder } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowGate, zodMessage } from '../../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'pocStandingOrder';

const bodySchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/, 'Unknown standing order'),
  action: z.enum(['approve', 'retire']),
  /** approve: must equal STANDING_ORDER_ATTESTATION */
  attestation: z.string().trim().max(200).optional().nullable(),
  /** approve: who / when the order covers (required when the draft has none) */
  criteria: z.string().trim().max(300).optional().nullable(),
});

/**
 * POST /api/medical/primary-care-settings/standing-orders — approve (verified Medical Director, with
 * the attestation) or retire (Medical Director or leadership) one point-of-care standing order.
 * Approval records approver id / name, date and the attestation text. Every call is audited.
 */
export async function POST(req: Request) {
  const g = await workflowGate(req, { action: 'UPDATE', resourceType: RESOURCE, allow: canViewPrimaryCareWorkflow });
  if (g.ok === false) return g.response;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ success: false, error: zodMessage(err, 'Check the request') }, { status: 400 });
  }
  try {
    const r = await actOnStandingOrder(g.viewer, body);
    const action = body.action === 'approve' ? 'APPROVE' : 'RETIRE';
    if (r.ok === false) {
      await auditPhiAccess({
        gate: g.gate, req, action, resourceType: RESOURCE, resourceId: body.key,
        outcome: r.status === 403 ? 'DENIED' : 'FAILURE',
        metadata: { key: body.key, reason: r.error },
      });
      return NextResponse.json({ success: false, error: r.error }, { status: r.status });
    }
    await auditPhiAccess({
      gate: g.gate, req, action, resourceType: RESOURCE, resourceId: body.key,
      metadata: { key: body.key, status: r.order.status, cpt: r.order.cpt ?? null, ...(r.order.approval ? { approvedAt: r.order.approval.approvedAt, attested: true } : {}) },
    });
    return NextResponse.json({ success: true, settings: r.settings, order: r.order });
  } catch (err) {
    console.error('[medical/primary-care-settings/standing-orders POST]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not save the standing order' }, { status: 500 });
  }
}
