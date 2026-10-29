import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canMutateLedger, STUB_CHARGE_BLOCKED, stubCharge, stubChargesAllowed } from '@/lib/billing/ledger';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clientId: z.string().min(1).max(128),
  amountCents: z.number().int(),
  last4: z.string().trim().max(4).optional().nullable(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canMutateLedger(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/autopay')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    // No-money stub charges: developer machines that opted in only (never staging / production)
    if (!stubChargesAllowed()) {
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'payment', patientId: body.clientId,
        outcome: 'DENIED', metadata: { method: 'STUB', reason: 'stub_charges_disabled' },
      });
      return NextResponse.json({ success: false, error: STUB_CHARGE_BLOCKED }, { status: 403 });
    }
    const result = await stubCharge(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role as Role,
      },
      body
    );
    if (!result.ok) {
      if (result.status === 404) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'payment', patientId: body.clientId,
          outcome: 'DENIED', metadata: { method: 'STUB', reason: 'client_not_found' },
        });
      }
      return NextResponse.json(
        {
          success: false,
          error:
            result.error === 'Stripe is configured. Use a real charge path instead of the stub.'
              ? 'Patient card charges are not on Stripe Checkout yet. Record a payment on the Payments page, or collect the card in Stripe Dashboard until patient Checkout is enabled.'
              : result.error,
        },
        { status: result.status }
      );
    }
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'payment', resourceId: result.payment.id,
      patientId: result.payment.clientId, metadata: { method: 'STUB', fields: ['amountCents', 'method', 'note'] },
    });
    return NextResponse.json({ success: true, payment: result.payment, stub: true }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid charge' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not stub charge' }, { status: 400 });
  }
}
