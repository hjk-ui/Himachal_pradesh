import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { listMessageThreads } from '@/lib/messages/manage';
import { canAccessClientMessages } from '@/lib/clients/orgScope';

/** Legacy alias → same as GET /api/messages/threads */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClientMessages(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to view messages' },
      { status: 403 }
    );
  }

  try {
    const threads = await listMessageThreads({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    return NextResponse.json({ success: true, threads });
  } catch (err) {
    console.error('[messages GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to load messages' }, { status: 500 });
  }
}
