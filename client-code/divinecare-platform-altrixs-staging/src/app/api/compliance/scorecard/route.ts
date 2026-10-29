import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { getModuleSnapshot } from '@/lib/modules/manage';
import {
  CARF_SCORECARD_MODULES,
  computeCarfScorecard,
  type CarfInputs,
} from '@/lib/compliance/carfScorecard';
import { incidentMetricRecord, incidentsForOrgMetrics } from '@/lib/incidents/store';

export const runtime = 'nodejs';

/** CARF readiness percentages for /dashboard/compliance (same roles as the page; no records). */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/compliance')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const keys = Object.keys(CARF_SCORECARD_MODULES) as (keyof Omit<CarfInputs, 'incidents'>)[];
    const [snapshots, incidents] = await Promise.all([
      Promise.all(keys.map((key) => getModuleSnapshot(gate.organizationId, CARF_SCORECARD_MODULES[key]))),
      // Incident reports are relational (IncidentReport); only the percentages leave this route
      incidentsForOrgMetrics(gate.organizationId),
    ]);
    const inputs = {
      ...Object.fromEntries(keys.map((key, i) => [key, Array.isArray(snapshots[i].data) ? snapshots[i].data : []])),
      incidents: incidents.map(incidentMetricRecord),
    } as CarfInputs;
    return NextResponse.json(
      { success: true, scorecard: computeCarfScorecard(inputs) },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[compliance/scorecard GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the scorecard' }, { status: 500 });
  }
}
