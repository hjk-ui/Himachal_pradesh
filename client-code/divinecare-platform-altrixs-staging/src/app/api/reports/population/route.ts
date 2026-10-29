import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { POPULATION_PATH, parsePopulationFilters } from '@/lib/reports/populationHealth';
import { buildPopulationHealth } from '@/lib/reports/populationHealthQueries';
import { ReportFilterError, resolveReportScope } from '@/lib/reports/outcomesReportsQueries';

export const runtime = 'nodejs';

/**
 * GET /api/reports/population?location&clinician[&list=tier:high|action:no_visit_60&page&pageSize]
 * Population Health from server-side aggregates over every ACTIVE client in scope (not the paged
 * client list). Same role gate as /dashboard/population. Org scoped; caseload roles only their
 * assigned clients; locked Part 2 / protected clients are left out and counted. Audit metadata
 * holds filters and counts only; the returned lists carry client names (protected: alias only).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, POPULATION_PATH, gate.capabilities)) {
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'populationHealth', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const parsed = parsePopulationFilters(new URL(req.url).searchParams);
  if ('error' in parsed) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const filters = parsed.filters;

  try {
    const scope = await resolveReportScope(
      { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
      { locationId: filters.locationId, clinicianId: filters.clinicianId } as Parameters<typeof resolveReportScope>[1]
    );
    const report = await buildPopulationHealth(scope, filters, new Date());
    const listedRows =
      Object.values(report.tiers).reduce((s, t) => s + t.preview.length, 0) +
      report.actions.reduce((s, a) => s + a.preview.length, 0) +
      (report.list?.rows.length ?? 0);

    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'populationHealth',
      metadata: {
        scope: report.scope,
        locationFilter: Boolean(filters.locationId), clinicianFilter: Boolean(filters.clinicianId),
        list: filters.list, page: report.list?.page ?? null,
        activeCaseload: report.activeCaseload, hiddenSensitiveClients: report.hiddenSensitiveClients,
        clientRows: listedRows,
      },
    });
    return NextResponse.json({ success: true, report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof ReportFilterError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    console.error('[reports/population GET]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not build population health' }, { status: 500 });
  }
}
