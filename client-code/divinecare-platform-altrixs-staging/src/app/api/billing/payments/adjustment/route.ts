import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canMutateLedger, createPaymentAdjustment } from '@/lib/billing/ledger';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const schema = z.object({
  clientId: z.string().min(1).max(128),
  claimId: z.string().min(1).max(128),
  /** Negative for a payer take-back / reversal; never zero */
  amountCents: z.number().int().refine((v) => v !== 0, 'Amount cannot be zero'),
  kind: z.enum(['reversal', 'adjustment']),
  reason: z.string().trim().min(3).max(180),
  paidAt: z.string().trim().max(40).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(100).optional().nullable(),
});

/** POST: payer reversal (CLP02 22 take-back) or correcting adjustment on a claim. Audited; idempotent with a key. */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/billing/payments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  // Reversals / adjustments (write-offs) are billing core only (canMutateLedger); Office Manager and
  // Front Desk post patient payments only
  if (!canMutateLedger(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'payment', outcome: 'DENIED', metadata: { reason: 'adjustment_requires_billing' } });
    return NextResponse.json({ success: false, error: 'Only billing staff can post reversals or adjustments' }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid adjustment' }, { status: 400 });
  const body = parsed.data;
  const result = await createPaymentAdjustment(
    { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role },
    { ...body, idempotencyKey: body.idempotencyKey || req.headers.get('idempotency-key') }
  );
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'payment', resourceId: result.payment.id, patientId: result.payment.clientId, metadata: { kind: body.kind, duplicate: result.duplicate } });
  return NextResponse.json({ success: true, payment: result.payment, duplicate: result.duplicate });
}
