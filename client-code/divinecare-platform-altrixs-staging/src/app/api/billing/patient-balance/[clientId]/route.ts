import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canReadLedger } from '@/lib/billing/ledger';
import { listLedgerEntries, patientBalance } from '@/lib/billing/patientLedger';

export const runtime = 'nodejs';

/**
 * GET /api/billing/patient-balance/[clientId] — the patient's ledger balance with its breakdown
 * (Valant opening balance, prepayment credit, Altrixs claims, patient payments) and ledger entry history.
 * Same rule as the chart billing card: ledger readers who can open Payments or Valant Balances.
 */
export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const allowed =
    canReadLedger(gate.role as Role) &&
    (canAccessPath(gate.role, '/dashboard/billing/payments') || canAccessPath(gate.role, '/dashboard/billing/valant-balances'));
  if (!allowed) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { clientId } = await ctx.params;
  try {
    const actor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role };
    const client = await prisma.client.findFirst({ where: { id: clientId, AND: [clientAccessWhere(actor)] }, select: { id: true } });
    if (!client) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'patientBalance', patientId: clientId, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    const [balance, ledger] = await Promise.all([
      patientBalance(gate.organizationId, client.id),
      listLedgerEntries(gate.organizationId, { clientId: client.id, includeSuperseded: true, take: 50 }),
    ]);
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'patientBalance', patientId: client.id,
      metadata: { view: 'chart_balance', entries: ledger.entries.length },
    });
    return NextResponse.json({ success: true, balance, entries: ledger.entries, schemaReady: ledger.schemaReady });
  } catch (err) {
    console.error('[billing patient-balance GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the patient balance' }, { status: 500 });
  }
}
