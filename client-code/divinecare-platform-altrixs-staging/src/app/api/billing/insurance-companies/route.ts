import { NextResponse } from 'next/server';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canEditValantPayers, listInsuranceCompanies } from '@/lib/billing/valantPayersDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/insurance-companies — Valant insurance companies with their addresses, the
 * number of clients whose insurance payer name matches (exact or staff-confirmed), Valant A/R
 * and journal usage, the linked / suggested payer registry entry and the Waystar mapping.
 * Counts only (no client identities). Same roles as Billing › Payer settings.
 */
export async function GET(req: Request) {
  const gate = await requireClinicalContext('/dashboard/billing/insurance-companies');
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  try {
    const data = await listInsuranceCompanies(gate.organizationId);
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'valantPayer',
      metadata: { view: 'insurance_companies', payers: data.rows.length, aggregateClientCounts: true },
    });
    return NextResponse.json({ success: true, canEdit: canEditValantPayers(gate.role), ...data });
  } catch (error) {
    console.error('[insurance-companies GET]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json(
      { success: false, error: 'Could not load insurance companies (has the 20261018_valant_payers migration run?)' },
      { status: 500 }
    );
  }
}
