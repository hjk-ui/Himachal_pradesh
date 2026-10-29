import { NextResponse } from 'next/server';
import { auditHr, hrGate, hrJsonError } from '@/lib/hr/server';
import { loadPayPeriodSummary, resolvePeriod } from '@/lib/hr/homebase/data';
import { homebaseServerError } from '@/lib/hr/homebase/http';

export const runtime = 'nodejs';

/** GET /api/hr/homebase/pay-period?start=&end=: Homebase hours per employee for the period (from the synced cache). */
export async function GET(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  try {
    const period = await resolvePeriod(g.ctx.organizationId, new URL(req.url));
    if ('error' in period) return hrJsonError(period.error, 400);
    const data = await loadPayPeriodSummary(g.ctx.organizationId, period.start, period.end);
    if (!data) return hrJsonError('Invalid period', 400);
    await auditHr(g.ctx, req, 'HR_HOMEBASE_PAY_PERIOD_VIEW', 'HomebaseTimecard', null, { periodStart: period.start, periodEnd: period.end, employees: data.rows.length });
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    return homebaseServerError('pay period', err);
  }
}
