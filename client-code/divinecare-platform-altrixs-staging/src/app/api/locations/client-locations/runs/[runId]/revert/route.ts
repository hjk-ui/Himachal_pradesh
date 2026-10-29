import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { PlanChangedError, requireLeadership, revertLocationRun } from '@/lib/locations/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Ctx = { params: Promise<{ runId: string }> };

/** Undo one run: clients still at the run's new location go back to their previous location. */
export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireLeadership();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { runId } = await ctx.params;
  if (!/^locrun_[0-9a-f-]{36}$/.test(runId)) return NextResponse.json({ success: false, error: 'Unknown run' }, { status: 400 });
  try {
    const result = await revertLocationRun(gate.organizationId, gate.userId, runId);
    await auditPhiAccess({
      gate,
      req,
      action: 'CLIENT_LOCATIONS_RECOMPUTE_REVERT',
      resourceType: 'Client',
      resourceId: runId,
      metadata: result,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof PlanChangedError) return NextResponse.json({ success: false, error: err.message }, { status: 409 });
    console.error('[api/locations/client-locations/revert] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not undo the run' }, { status: 500 });
  }
}
