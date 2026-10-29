import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  canViewCopayRules,
  canViewValantBalances,
  clientCopayRules,
  clientValantReference,
  REFERENCE_ONLY_NOTE,
} from '@/lib/billing/valantBalances';
import { VALANT_LIMIT_LABEL } from '@/lib/migration/valantCopays';

export const runtime = 'nodejs';

/**
 * GET /api/billing/valant-balances/client/[id] — chart card: Valant aging / combined aging /
 * prepayment (billing roles + leadership) and copay rules (anyone who collects payments).
 * Reference only; nothing here is on the Altrixs ledger.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const balances = canViewValantBalances(gate.role);
  const copays = canViewCopayRules(gate.role);
  if (!balances && !copays) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const client = await prisma.client.findFirst({ where: { id, organizationId: gate.organizationId }, select: { id: true } });
    if (!client) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'valantBalances', patientId: id, outcome: 'DENIED', metadata: { reason: 'client_not_found' } });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    const [reference, rules] = await Promise.all([
      balances ? clientValantReference(gate.organizationId, id) : Promise.resolve(null),
      copays ? clientCopayRules(gate.organizationId, id) : Promise.resolve(null),
    ]);
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'valantBalances', patientId: id,
      metadata: {
        view: 'client_card',
        aging: Boolean(reference?.aging), combined: Boolean(reference?.combined), prepayment: Boolean(reference?.prepayment),
        copayRules: rules?.length ?? 0,
      },
    });
    return NextResponse.json({ success: true, note: REFERENCE_ONLY_NOTE, valantLimitLabel: VALANT_LIMIT_LABEL, reference, copayRules: rules });
  } catch (err) {
    console.error('[valant-balances client GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load Valant reference data' }, { status: 500 });
  }
}
