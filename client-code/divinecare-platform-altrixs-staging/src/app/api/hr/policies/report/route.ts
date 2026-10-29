import { NextResponse } from 'next/server';
import { acknowledgmentReport } from '@/lib/hr/policies';
import { auditHr, hrGate, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

/** GET: acknowledgment completion per required policy (who has not acknowledged). HR + leadership. */
export async function GET(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  try {
    const report = await acknowledgmentReport(g.ctx.organizationId);
    await auditHr(g.ctx, req, 'LIST', 'hrPolicyAcknowledgment', null, { policies: report.length });
    return NextResponse.json({ success: true, report });
  } catch (err) {
    return hrServerError('policy report', err);
  }
}
