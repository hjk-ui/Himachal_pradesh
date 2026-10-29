import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canReadLedger } from '@/lib/billing/ledger';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { clientByIdWhere } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

/**
 * Charge history for one client on the AutoPay page: recorded patient payments (Payment rows, newest first)
 * and card-on-file charge attempts (AutoPayCharge rows). Nothing is synthesized.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canReadLedger(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/autopay')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const clientId = new URL(req.url).searchParams.get('clientId')?.trim() ?? '';
  if (!clientId || clientId.length > 128) {
    return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  }
  try {
    const client = await prisma.client.findFirst({
      where: clientByIdWhere(clientId, gate.organizationId),
      select: { id: true },
    });
    if (!client) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'autopayHistory', patientId: clientId,
        outcome: 'DENIED', metadata: { reason: 'client_not_found' },
      });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    const [payments, attempts] = await Promise.all([
      prisma.payment.findMany({
        where: { clientId: client.id, organizationId: gate.organizationId, method: { not: 'INSURANCE' } },
        orderBy: { paidAt: 'desc' },
        take: 25,
        select: { id: true, amountCents: true, method: true, paidAt: true, note: true },
      }),
      prisma.autoPayCharge
        .findMany({
          where: { card: { clientId: client.id, organizationId: gate.organizationId } },
          orderBy: { chargedAt: 'desc' },
          take: 25,
          select: { id: true, amount: true, status: true, failureReason: true, chargedAt: true },
        })
        .catch(() => []),
    ]);
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'autopayHistory', patientId: client.id,
      metadata: { payments: payments.length, attempts: attempts.length },
    });
    return NextResponse.json({
      success: true,
      payments: payments.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        method: p.method,
        paidAt: p.paidAt.toISOString(),
        note: p.note,
        stub: p.method === 'STUB',
      })),
      attempts: attempts.map((a) => ({
        id: a.id,
        // AutoPayCharge.amount is a Float in dollars
        amountCents: Math.round(a.amount * 100),
        status: a.status,
        failureReason: a.failureReason,
        chargedAt: a.chargedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[billing autopay history GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load charge history' }, { status: 500 });
  }
}
