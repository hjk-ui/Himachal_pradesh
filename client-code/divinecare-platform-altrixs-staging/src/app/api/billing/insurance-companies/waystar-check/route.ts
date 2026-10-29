import { NextResponse } from 'next/server';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { waystarValantCheck } from '@/lib/billing/valantPayersDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/insurance-companies/waystar-check — for each Waystar payer mapping, the Valant
 * payers with the same name (or a known program equivalent) and their Valant EDI payer IDs, with
 * the IDs that differ from the Waystar ID. Read-only reference for the payer settings page: it
 * never writes a mapping (Valant's clearinghouse IDs can differ from Waystar's).
 */
export async function GET(req: Request) {
  const gate = await requireClinicalContext('/dashboard/billing/payer-settings');
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  try {
    const data = await waystarValantCheck(gate.organizationId);
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'valantPayer',
      metadata: { view: 'waystar_valant_check', mappings: data.references.length, discrepancies: data.references.filter((r) => r.discrepancies.length).length },
    });
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error('[insurance-companies waystar-check]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: true, imported: false, references: [], unavailable: true });
  }
}
