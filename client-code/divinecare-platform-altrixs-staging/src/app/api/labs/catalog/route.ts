import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canViewLabs } from '@/lib/labs/access';
import { loadOrgCatalog } from '@/lib/labs/catalogDb';
import { LAB_ORDER_SETS, ORDER_SET_SOURCES } from '@/lib/labs/orderSets';

export const runtime = 'nodejs';

/**
 * GET /api/labs/catalog — the org's orderable tests (built-in catalog merged with imported Valant
 * lab request types) plus the medication-monitoring order sets. Reference data only: no patient
 * data, so no PHI audit entry.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canViewLabs(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const tests = await loadOrgCatalog(gate.organizationId);
    return NextResponse.json({ success: true, tests, orderSets: LAB_ORDER_SETS, orderSetSources: ORDER_SET_SOURCES });
  } catch (err) {
    console.error('[labs/catalog GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the lab catalog' }, { status: 500 });
  }
}
