import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canOpenLibrary } from '@/lib/reports/library/server';
import { SavedViewError, deleteSavedView, updateSavedView } from '@/lib/reports/library/saved';

export const runtime = 'nodejs';

/** PATCH { name?, schedule?, scheduleHour?, scheduleWeekday? } / DELETE one of the user's own saved reports. */
export async function PATCH(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canOpenLibrary(gate.role, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { sid } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
  try {
    const view = await updateSavedView(gate, sid, body);
    await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'reportSavedView', resourceId: view.id, metadata: { reportId: view.reportId, schedule: view.schedule, op: 'update' } });
    return NextResponse.json({ success: true, view });
  } catch (err) {
    if (err instanceof SavedViewError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[reports/library/saved PATCH]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not update the saved report' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canOpenLibrary(gate.role, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { sid } = await params;
  try {
    await deleteSavedView(gate, sid);
    await auditPhiAccess({ gate, req, action: 'DELETE', resourceType: 'reportSavedView', resourceId: sid, metadata: { op: 'delete' } });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof SavedViewError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[reports/library/saved DELETE]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not delete the saved report' }, { status: 500 });
  }
}
