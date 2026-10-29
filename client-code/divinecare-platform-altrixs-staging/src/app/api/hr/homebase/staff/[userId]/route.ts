import { NextResponse } from 'next/server';
import { assertOrgUser, auditHr, hrGate, hrJsonError } from '@/lib/hr/server';
import { loadStaffHours, resolvePeriod } from '@/lib/hr/homebase/data';
import { homebaseServerError } from '@/lib/hr/homebase/http';

export const runtime = 'nodejs';

/** GET /api/hr/homebase/staff/:userId?start=&end=: one staff member's Homebase shifts + timecards (read-only). */
export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const { userId } = await params;
  try {
    if (!(await assertOrgUser(g.ctx.organizationId, userId))) return hrJsonError('Not found', 404);
    const period = await resolvePeriod(g.ctx.organizationId, new URL(req.url));
    if ('error' in period) return hrJsonError(period.error, 400);
    const data = await loadStaffHours(g.ctx.organizationId, userId, period.start, period.end);
    if (!data) return hrJsonError('Invalid period', 400);
    await auditHr(g.ctx, req, 'HR_HOMEBASE_STAFF_HOURS_VIEW', 'StaffHrProfile', userId, {
      periodStart: period.start,
      periodEnd: period.end,
      shifts: data.shifts.length,
      timecards: data.timecards.length,
    });
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    return homebaseServerError('staff hours', err);
  }
}
