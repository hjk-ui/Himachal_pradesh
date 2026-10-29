import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listEhrProgressNotes } from '@/lib/clients/notes';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const canReadNotesFeed = canAccessPath(gate.role, '/dashboard/ehr/notes');
  if (!canReadNotesFeed) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const includeDismissed = new URL(req.url).searchParams.get('includeDismissed') === '1';
  const result = await listEhrProgressNotes({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    includeDismissed,
  });

  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({
    success: true,
    notes: result.notes,
    stats: result.stats,
  });
}
