import { NextResponse } from 'next/server';
import { auditHr, hrGate } from '@/lib/hr/server';
import { loadHomebaseStatus } from '@/lib/hr/homebase/data';
import { homebaseServerError } from '@/lib/hr/homebase/http';

export const runtime = 'nodejs';

/** GET /api/hr/homebase: connection status, last sync, cache counts, location mapping (HR + leadership). */
export async function GET(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  try {
    const status = await loadHomebaseStatus(g.ctx.organizationId);
    await auditHr(g.ctx, req, 'HR_HOMEBASE_STATUS_VIEW', 'HomebaseConnection', null, { connected: status.connection.connected });
    return NextResponse.json({ success: true, ...status });
  } catch (err) {
    return homebaseServerError('status', err);
  }
}
