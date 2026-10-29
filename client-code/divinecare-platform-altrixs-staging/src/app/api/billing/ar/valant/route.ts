import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessArControl } from '@/lib/billing/arControl';
import { getValantRunoutAr, parseWorklistQuery } from '@/lib/billing/arControlValant';

export const runtime = 'nodejs';

/**
 * GET /api/billing/ar/valant — Valant run-out A/R for the A/R Control Center (read only; latest Valant imports).
 * Worklist query: ?payer=&bucket=0-4&min=<dollars>&party=primary|secondary|other&q=&unmatched=1
 *                 &sort=oldest|amount|lastBilled|name&page=&pageSize= (max 200)
 * Same role gate as GET /api/billing/ar. The audit entry records counts only (worklist lines carry clientId).
 */
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
    const { allWorklistRows: _all, ...data } = await getValantRunoutAr(gate.organizationId, query);
    void _all;
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'valantRunoutAr',
      metadata: {
        view: 'ar_control_valant_runout',
        asOf: data.latestAsOf,
        payers: data.byPayer.length,
        worklistMatches: data.worklist.total,
        worklistReturned: data.worklist.rows.length,
        page: data.worklist.page,
      },
    });
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[billing ar valant GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load Valant run-out A/R' }, { status: 500 });
  }
}
