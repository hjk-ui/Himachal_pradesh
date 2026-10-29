import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { LAB_ORDER_STATUSES, LAB_RESULT_FLAGS, getOrder, patchOrder } from '@/lib/labs/manage';
import { labError, labGate } from '@/lib/labs/routeGate';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const resultSchema = z.object({
  testName: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(40).optional().nullable(),
  refRange: z.string().trim().max(80).optional().nullable(),
  /** Lab's printed flag; omit to compute from the entered range */
  flag: z.enum(LAB_RESULT_FLAGS).optional().nullable(),
  testKey: z.string().trim().max(80).optional().nullable(),
  panelName: z.string().trim().max(200).optional().nullable(),
  loinc: z.string().trim().max(20).optional().nullable(),
  criticalRange: z.string().trim().max(80).optional().nullable(),
  collectedAt: z.string().trim().max(40).optional().nullable(),
  performingLab: z.string().trim().max(120).optional().nullable(),
});

const patchSchema = z.object({
  status: z.enum(LAB_ORDER_STATUSES).optional(),
  results: z.array(resultSchema).max(150).optional(),
  collectedAt: z.string().trim().max(40).optional().nullable(),
  resultedAt: z.string().trim().max(40).optional().nullable(),
  clinicalNotes: z.string().trim().max(4000).optional().nullable(),
  performingLabName: z.string().trim().max(120).optional().nullable(),
  resultDocumentId: z.string().trim().max(128).optional().nullable(),
});

/** GET /api/labs/orders/[id] */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await labGate(req, 'view');
  if (g.denied) return g.denied;
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const order = await getOrder(g.actor, id);
    if (!order) return NextResponse.json({ success: false, error: 'Lab order not found' }, { status: 404 });
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'labOrder', resourceId: order.id, patientId: order.clientId });
    return NextResponse.json({ success: true, order }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return labError(err, 'labs/orders/[id] GET', 'Could not load the lab order');
  }
}

/**
 * PATCH /api/labs/orders/[id] — collection / sent-to-lab steps, result entry (flags computed from
 * the entered range), report attachment. Prescribers, medical assistants, CLINICIAN and leadership;
 * sign-off is a separate route (/review).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await labGate(req, 'enter');
  if (g.denied) return g.denied;
  const { gate, actor } = g;
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = patchSchema.parse(await req.json());
    const me = await prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true, email: true } });
    const result = await patchOrder(actor, id, body, me?.name?.trim() || me?.email || null);
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'labOrder', resourceId: result.order.id, patientId: result.order.clientId,
      metadata: {
        status: result.order.status,
        resultCount: body.results ? result.order.results.length : undefined,
        critical: result.order.hasCritical,
        attachment: body.resultDocumentId !== undefined ? Boolean(body.resultDocumentId) : undefined,
        reviewCleared: result.reviewCleared || undefined,
      },
    });
    return NextResponse.json({ success: true, order: result.order, reviewCleared: result.reviewCleared });
  } catch (err) {
    return labError(err, 'labs/orders/[id] PATCH', 'Could not update lab order');
  }
}
