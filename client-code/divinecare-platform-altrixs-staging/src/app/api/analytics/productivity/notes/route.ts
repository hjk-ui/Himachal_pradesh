import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listNoteProductivityRows } from '@/lib/analytics/noteProductivity';

export const runtime = 'nodejs';

/** Note timing metadata for /dashboard/analytics/productivity (same roles as the page; no bodies). */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/analytics/productivity')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const notes = await listNoteProductivityRows({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    return NextResponse.json({ success: true, notes });
  } catch (err) {
    console.error('[analytics/productivity/notes GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load note metrics' }, { status: 500 });
  }
}
