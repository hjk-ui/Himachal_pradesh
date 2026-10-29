import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { loadClinicianDocMetrics } from '@/lib/analytics/visitDocumentationServer';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/**
 * GET ?days=7|14|30: per-clinician documentation metrics computed on the server from completed
 * appointments and the linked ProgressNoteWorkflow signatures (same roles as the page; no note bodies).
 */
export async function GET(request: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/analytics/productivity')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const raw = Number(new URL(request.url).searchParams.get('days') ?? 7);
  const days = [7, 14, 30].includes(raw) ? raw : 7;
  try {
    const data = await loadClinicianDocMetrics({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      days,
    });
    // Overdue list names clients (Part 2 masked): log the read, counts only.
    await auditPhiAccess({
      gate, req: request, action: 'LIST', resourceType: 'documentationProductivity',
      metadata: { days, clinicians: data.clinicians.length, overdue: data.clinicians.reduce((s, c) => s + c.overdue, 0) },
    });
    return NextResponse.json({ success: true, ...data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[analytics/productivity/metrics GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load documentation metrics' }, { status: 500 });
  }
}
