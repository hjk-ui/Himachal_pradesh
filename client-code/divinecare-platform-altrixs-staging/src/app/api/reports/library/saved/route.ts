import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canOpenLibrary } from '@/lib/reports/library/server';
import { SavedViewError, createSavedView, listSavedViews } from '@/lib/reports/library/saved';

export const runtime = 'nodejs';

/**
 * GET  /api/reports/library/saved: the signed-in user's saved reports (their own only).
 * POST /api/reports/library/saved  { reportId, name, params, schedule, scheduleHour, scheduleWeekday }
 * Stores the report id and validated parameters only (never results). A schedule emails the
 * owner a sign-in link with no patient information. Writes are audit-logged.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canOpenLibrary(gate.role, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const r = await listSavedViews(gate);
    return NextResponse.json({ success: true, ...r }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[reports/library/saved GET]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load saved reports' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canOpenLibrary(gate.role, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
  try {
    const view = await createSavedView(gate, body);
    await auditPhiAccess({
      gate, req, action: 'WRITE', resourceType: 'reportSavedView', resourceId: view.id,
      metadata: { reportId: view.reportId, schedule: view.schedule, op: 'create' },
    });
    return NextResponse.json({ success: true, view });
  } catch (err) {
    if (err instanceof SavedViewError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[reports/library/saved POST]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not save the report (has migration 20261019_report_library.sql been applied?)' }, { status: 500 });
  }
}
