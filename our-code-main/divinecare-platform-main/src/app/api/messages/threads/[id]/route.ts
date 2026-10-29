import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  findThreadIdByClient,
  listThreadMessages,
  markThreadRead,
  patchMessageThread,
} from '@/lib/messages/manage';
import { canAccessClientMessages } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const patchSchema = z.object({
  status: z.enum(['waiting', 'in-progress', 'forwarded', 'resolved']).optional().nullable(),
  forwardedTo: z.string().max(120).optional().nullable(),
  forwardNote: z.string().max(2000).optional().nullable(),
  assignedStaff: z.string().max(120).optional().nullable(),
});

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientMessages(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let { id } = await ctx.params;
  // Allow ?resolveClient=1 with id=clientId fallback via query
  const url = new URL(req.url);
  if (url.searchParams.get('byClient') === '1') {
    const found = await findThreadIdByClient({
      clientId: id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    if (!found) {
      return NextResponse.json({ success: false, error: 'Thread not found' }, { status: 404 });
    }
    id = found;
  }

  const result = await listThreadMessages({
    threadId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  await markThreadRead({
    threadId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });

  return NextResponse.json({
    success: true,
    thread: { ...result.thread, unreadCount: 0 },
    messages: result.messages,
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientMessages(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const result = await patchMessageThread({
      threadId: id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      actorName: gate.session.user.name,
      ...body,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, thread: result.thread });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not update thread';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
