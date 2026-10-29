import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { REPORT_AUDIT_RESOURCE, canOpenLibrary, getReport, runLibraryReport } from '@/lib/reports/library/server';

export const runtime = 'nodejs';

/**
 * POST /api/reports/library/[id]/run  body: { preset, from, to, site, provider, payer, <select params>, page, pageSize }
 * Runs one report for the signed-in viewer: per-report role check, org + caseload + Part 2 scope,
 * small-cell suppression, paging. Every run (and every denial) is audit-logged with the report id,
 * parameters and row count only; patient-level rows carry clientId for links to the chart.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await params;
  const def = getReport(id);
  if (!def) return NextResponse.json({ success: false, error: 'Unknown report' }, { status: 404 });
  if (!canOpenLibrary(gate.role, gate.capabilities)) {
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: REPORT_AUDIT_RESOURCE, resourceId: def.id, outcome: 'DENIED',
      metadata: { reportId: def.id, reason: 'library_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  try {
    const r = await runLibraryReport(gate, req, def, body, { kind: 'view' });
    if ('error' in r) return NextResponse.json({ success: false, error: r.error }, { status: r.status });
    return NextResponse.json({ success: true, result: r.result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[reports/library run]', def.id, err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not run the report' }, { status: 500 });
  }
}
