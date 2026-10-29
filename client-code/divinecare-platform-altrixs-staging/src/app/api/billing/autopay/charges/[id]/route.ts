import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { refundCharge, retryCharge, voidCharge } from '@/lib/patientPayments/service';
import { patientPaymentsDeps } from '@/lib/patientPayments/server';
import { prisma } from '@/lib/db/prisma';
import { autopayGate, scopedClientId } from '../../_gate';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retry') }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('void'), reason: z.string().max(200).optional().nullable() }),
  z.object({ action: z.literal('refund'), amountCents: z.number().int().positive().optional().nullable(), reason: z.string().min(1).max(200) }),
]);

/** POST: billing retries / approves a held charge / voids / refunds one automatic card charge. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await autopayGate('charges');
  if (g.ok === false) return NextResponse.json({ success: false, error: g.error }, { status: g.status });
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const row = await prisma.patientCharge.findFirst({ where: { id, organizationId: g.gate.organizationId }, select: { clientId: true } }).catch(() => null);
  if (!row || !(await scopedClientId(g.gate, row.clientId))) {
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'PatientCharge', resourceId: id, outcome: 'DENIED', metadata: { op: body.action, reason: 'not_found' } });
    return NextResponse.json({ success: false, error: 'Charge not found' }, { status: 404 });
  }
  const deps = patientPaymentsDeps();
  const base = { organizationId: g.gate.organizationId, chargeId: id, actor: g.actor };
  try {
    const result =
      body.action === 'retry'
        ? await retryCharge(deps, base)
        : body.action === 'approve'
          ? await retryCharge(deps, { ...base, approveHeld: true })
          : body.action === 'void'
            ? await voidCharge(deps, { ...base, reason: body.reason ?? null })
            : await refundCharge(deps, { ...base, amountCents: body.amountCents ?? null, reason: body.reason });
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error, code: result.code ?? null }, { status: result.status });
    return NextResponse.json({ success: true, chargeStatus: result.charge.status, message: 'message' in result ? result.message : null });
  } catch (err) {
    console.error('[autopay charge POST]', body.action, err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not complete the action' }, { status: 500 });
  }
}
