import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listEhrProgressNotes } from '@/lib/clients/notes';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

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

  const result = await listEhrProgressNotes({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });

  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  // Practice-wide note feed (Part 2 / VIP clients already dropped by listEhrProgressNotes)
  await auditPhiAccess({
    gate,
    req,
    action: 'LIST',
    resourceType: 'progressNote',
    metadata: { count: result.notes.length, ids: result.notes.slice(0, 50).map((n) => n.id) },
  });

  return NextResponse.json({
    success: true,
    notes: result.notes,
    stats: result.stats,
  });
}
