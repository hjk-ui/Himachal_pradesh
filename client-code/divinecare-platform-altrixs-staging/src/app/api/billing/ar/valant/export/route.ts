import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessArControl } from '@/lib/billing/arControl';
import { buildValantWorklistCsv, getValantRunoutAr, parseWorklistQuery } from '@/lib/billing/arControlValant';

export const runtime = 'nodejs';

/** GET /api/billing/ar/valant/export — CSV of the Valant run-out worklist (same filters as /api/billing/ar/valant, no paging) */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessArControl(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/ar-control')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const query = parseWorklistQuery(new URL(req.url).searchParams);
    const data = await getValantRunoutAr(gate.organizationId, query, { paginate: false });
    const csv = buildValantWorklistCsv(data.allWorklistRows, data.labels, data.asOf.combined);
    await auditPhiAccess({
      gate, req, action: 'EXPORT', resourceType: 'valantRunoutWorklist',
      metadata: { format: 'csv', asOf: data.asOf.combined, rows: data.allWorklistRows.length },
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="valant-runout-worklist-${data.asOf.combined ?? 'none'}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[billing ar valant export]', err);
    return NextResponse.json({ success: false, error: 'Could not export the Valant run-out worklist' }, { status: 500 });
  }
}
