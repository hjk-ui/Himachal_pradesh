import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { loadTodayPanel } from '@/lib/dashboard/todayServer';
import { serverTiming } from '@/lib/perf/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/today — the clinician "Today" panel in one read: the viewer's own visits on
 * today's practice clock (caseload scope: clientAccessWhere), each with its documentation light and
 * primary action, notes done today, and the inbox to-do count. Client ids / names only, as the role
 * homes already show; the read is audited with counts (no names or ids in metadata).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Not allowed to view appointments' }, { status: 403 });
  }
  try {
    const timing = serverTiming();
    const t0 = Date.now();
    const today = await loadTodayPanel({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role });
    timing.record('today', Date.now() - t0);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'dashboardToday',
      metadata: { visits: today.visits.length, notesDone: today.notes.done, notesTotal: today.notes.total, inbox: today.inbox?.toDo ?? null },
    });
    return NextResponse.json({ success: true, today }, { headers: { 'Cache-Control': 'no-store', 'Server-Timing': timing.header() } });
  } catch (err) {
    console.error('[api/dashboard/today GET]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load today' }, { status: 500 });
  }
}
