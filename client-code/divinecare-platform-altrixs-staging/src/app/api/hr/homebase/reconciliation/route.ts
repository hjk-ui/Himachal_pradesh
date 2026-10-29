import { NextResponse } from 'next/server';
import { auditHr, hrGate, hrJsonError } from '@/lib/hr/server';
import { loadReconciliation, resolvePeriod } from '@/lib/hr/homebase/data';
import { reconciliationCsv } from '@/lib/hr/homebase/reconcile';
import { homebaseServerError } from '@/lib/hr/homebase/http';

export const runtime = 'nodejs';

/**
 * GET /api/hr/homebase/reconciliation?start=&end=[&format=csv]: Homebase clocked hours vs.
 * documented visits per clinician. COUNTS and MINUTES only: HR never sees client information.
 */
export async function GET(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const url = new URL(req.url);
  const csv = url.searchParams.get('format') === 'csv';
  try {
    const period = await resolvePeriod(g.ctx.organizationId, url);
    if ('error' in period) return hrJsonError(period.error, 400);
    const data = await loadReconciliation(g.ctx.organizationId, period.start, period.end);
    if (!data) return hrJsonError('Invalid period', 400);
    await auditHr(g.ctx, req, csv ? 'HR_HOMEBASE_RECONCILIATION_EXPORT' : 'HR_HOMEBASE_RECONCILIATION_VIEW', 'PayrollReconciliation', null, {
      periodStart: period.start,
      periodEnd: period.end,
      clinicians: data.rows.length,
      flagged: data.totals.flagged,
      format: csv ? 'csv' : 'json',
    });
    if (csv) {
      return new NextResponse(reconciliationCsv(data.rows, period), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="payroll-reconciliation-${period.start}-to-${period.end}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    return homebaseServerError('reconciliation', err);
  }
}
