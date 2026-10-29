import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { REPORTS_PATH, buildReportCsv, parseReportFilters } from '@/lib/reports/outcomesReports';
import { ReportFilterError, buildOutcomesReport, resolveReportScope } from '@/lib/reports/outcomesReportsQueries';

export const runtime = 'nodejs';

/**
 * GET /api/reports/outcomes?from&to&location&clinician&tab[&format=csv]
 * Outcomes & Reports. Org scoped; caseload roles see only their assigned clients; sensitive
 * (Part 2 / protected) clients the viewer cannot open are left out and counted. Audit metadata
 * holds filters and counts only (the clinical tab returns client names for the outcome table).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, REPORTS_PATH, gate.capabilities)) {
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'outcomesReport', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date();
  const parsed = parseReportFilters(new URL(req.url).searchParams, now);
  if ('error' in parsed) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const filters = parsed.filters;

  try {
    const scope = await resolveReportScope(
      { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
      filters
    );
    const report = await buildOutcomesReport(scope, filters, now);
    const csv = filters.format === 'csv';

    await auditPhiAccess({
      gate, req, action: csv ? 'EXPORT' : 'READ', resourceType: 'outcomesReport',
      metadata: {
        tab: filters.tab, format: filters.format, from: filters.fromDate, to: filters.toDate,
        locationFilter: Boolean(filters.locationId), clinicianFilter: Boolean(filters.clinicianId),
        scope: report.scope, hiddenSensitiveClients: report.hiddenSensitiveClients,
        activeClients: report.overview.activeClients, appointments: report.overview.appointments.total,
        clientRows: report.clinical?.clients.length ?? 0,
      },
    });

    if (csv) {
      const org = await prisma.organization.findUnique({ where: { id: gate.organizationId }, select: { name: true } });
      return new NextResponse(buildReportCsv(report, org?.name ?? null), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="outcomes-${filters.tab}-${filters.fromDate}-to-${filters.toDate}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({ success: true, report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof ReportFilterError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    console.error('[reports/outcomes GET]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not build the report' }, { status: 500 });
  }
}
