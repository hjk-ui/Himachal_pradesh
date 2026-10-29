import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadPracticeOverview, requireOverviewViewer } from '@/lib/locations/server';

export const dynamic = 'force-dynamic';

/** Practice overview per location (Locations & enterprise, Admin › Locations). Leadership + Office Manager (read), audited. */
export async function GET(req: Request) {
  const gate = await requireOverviewViewer();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  try {
    const overview = await loadPracticeOverview(gate.organizationId);
    await auditPhiAccess({
      gate,
      req,
      action: 'PRACTICE_OVERVIEW_VIEW',
      resourceType: 'PracticeOverview',
      resourceId: gate.organizationId,
      metadata: {
        locations: overview.locations.length,
        clients: overview.totals.clients,
        warnings: overview.warnings.map((w) => w.code),
      },
    });
    return NextResponse.json({ success: true, overview });
  } catch (err) {
    console.error('[api/locations/overview] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load the practice overview' }, { status: 500 });
  }
}
