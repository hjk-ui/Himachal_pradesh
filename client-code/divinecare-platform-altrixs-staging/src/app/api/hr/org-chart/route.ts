import { NextResponse } from 'next/server';
import { directory, workforceAnalytics } from '@/lib/hr/orgChart';
import { hrGate, hrServerError } from '@/lib/hr/server';
import { isHrAdminRole } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/**
 * GET /api/hr/org-chart: staff directory and reporting lines for every staff member (work
 * information only); headcount and turnover analytics for HR + leadership.
 */
export async function GET() {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  try {
    const admin = isHrAdminRole(g.ctx.role);
    const [people, analytics] = await Promise.all([directory(g.ctx.organizationId), admin ? workforceAnalytics(g.ctx.organizationId) : null]);
    return NextResponse.json({ success: true, people, analytics, viewerUserId: g.ctx.userId });
  } catch (err) {
    return hrServerError('org chart', err);
  }
}
