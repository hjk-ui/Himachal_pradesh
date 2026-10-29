import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireValantBalancesGate } from '@/lib/billing/valantGate';

export const runtime = 'nodejs';

const bodySchema = z.object({
  txnIds: z.array(z.string().min(1).max(64)).min(1).max(1000),
  /** null moves the rows back to the Unmatched queue */
  clientId: z.string().min(1).max(128).nullable(),
});

/**
 * POST /api/billing/valant-balances/prepayments/assign — staff choose the patient for Valant
 * prepayment rows (reference only). The choice is kept across re-imports by the row hash.
 */
export async function POST(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = bodySchema.parse(await req.json());
    const orgId = gate.organizationId;
    if (body.clientId) {
      const client = await prisma.client.findFirst({ where: { id: body.clientId, organizationId: orgId }, select: { id: true } });
      if (!client) {
        await auditPhiAccess({
          gate, req, action: 'UPDATE', resourceType: 'valantPrepaymentTxn', patientId: body.clientId,
          outcome: 'DENIED', metadata: { reason: 'client_not_found', txns: body.txnIds.length },
        });
        return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
      }
    }
    const result = await prisma.valantPrepaymentTxn.updateMany({
      where: { organizationId: orgId, id: { in: body.txnIds } },
      data: body.clientId
        ? { clientId: body.clientId, matchMethod: 'manual', unmatchedReason: null, assignedById: gate.userId, assignedAt: new Date() }
        : { clientId: null, matchMethod: null, unmatchedReason: 'unassigned', assignedById: gate.userId, assignedAt: new Date() },
    });
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'valantPrepaymentTxn', patientId: body.clientId,
      metadata: { action: body.clientId ? 'assign' : 'unassign', requested: body.txnIds.length, updated: result.count, txnIds: body.txnIds.slice(0, 50) },
    });
    return NextResponse.json({ success: true, updated: result.count });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    console.error('[valant-balances prepayments assign POST]', err);
    return NextResponse.json({ success: false, error: 'Could not assign the prepayments' }, { status: 500 });
  }
}
