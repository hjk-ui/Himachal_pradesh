import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  PAYMENT_METHODS,
  canMutateLedger,
  canReadLedger,
  createPayment,
  listPayments,
} from '@/lib/billing/ledger';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { listLedgerEntries } from '@/lib/billing/patientLedger';
import { frontDeskPaymentFilter, isBillingCore, isPatientPaymentOnlyRole, paymentPostDecision } from '@/lib/billing/billingAccess';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canReadLedger(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/payments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const actor = actorFrom(gate);
    // Active ledger entries (Valant opening balances / prepayment credits) appear in the payment history
    const [all, ledger] = await Promise.all([
      listPayments(actor),
      listLedgerEntries(gate.organizationId, { clientWhere: clientAccessWhere(actor), take: 500 }),
    ]);
    // Front Desk: patient payments only (card / cash / check / ACH, not applied to a claim);
    // insurance payments and claim postings are billing data.
    const data = { ...all, payments: frontDeskPaymentFilter(gate.role, all.payments) };
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'payment',
      metadata: { count: data.payments.length, ledgerEntries: ledger.entries.length, ...(gate.role === 'FRONT_DESK' ? { scope: 'patient_payments' } : {}) },
    });
    return NextResponse.json({ success: true, ...data, ledgerEntries: ledger.entries });
  } catch (err) {
    console.error('[billing payments GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load payments' }, { status: 500 });
  }
}

const createSchema = z.object({
  clientId: z.string().min(1).max(128),
  claimId: z.string().min(1).max(128).optional().nullable(),
  amountCents: z.number().int(),
  method: z.enum(PAYMENT_METHODS),
  note: z.string().trim().max(400).optional().nullable(),
  paidAt: z.string().trim().max(40).optional().nullable(),
  /** One per form submission (also accepted as the Idempotency-Key header) */
  idempotencyKey: z.string().trim().min(8).max(100).optional().nullable(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Billing core: any payment. Office Manager / Front Desk: patient payments only (patient
  // method, no claim), checked against the body below by paymentPostDecision.
  const deskRole = gate.role === 'FRONT_DESK';
  if ((!canMutateLedger(gate.role) && !isPatientPaymentOnlyRole(gate.role)) || !canAccessPath(gate.role, '/dashboard/billing/payments')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = createSchema.parse(await req.json());
    const decision = paymentPostDecision(gate.role, { method: body.method, claimId: body.claimId });
    if ('reason' in decision) {
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'payment', patientId: body.clientId, outcome: 'DENIED',
        metadata: { method: body.method, claimId: body.claimId ?? null, reason: decision.reason },
      });
      return NextResponse.json({ success: false, error: decision.error }, { status: decision.status });
    }
    const result = await createPayment(actorFrom(gate), { ...body, idempotencyKey: body.idempotencyKey || req.headers.get('idempotency-key') });
    if (!result.ok) {
      if (result.status === 404) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'payment', patientId: body.clientId,
          outcome: 'DENIED', metadata: { claimId: body.claimId ?? null, reason: 'not_found' },
        });
      }
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'payment', resourceId: result.payment.id,
      patientId: result.payment.clientId,
      metadata: {
        claimId: result.payment.claimId,
        method: result.payment.method,
        scope: isBillingCore(gate.role) ? 'full' : 'patient_payment',
        ...(deskRole ? { source: 'front_desk_copay' } : {}),
        fields: Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] != null),
      },
    });
    return NextResponse.json({ success: true, payment: result.payment }, { status: 201 });
  } catch (err: unknown) {
    const missing =
      typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2021';
    const message = missing
      ? 'Payments table is not on this database yet'
      : err instanceof z.ZodError
        ? 'Invalid payment'
        : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not record payment' }, { status: 400 });
  }
}
