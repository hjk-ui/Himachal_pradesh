import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { listThreadMessages, markThreadRead, sendThreadMessage } from '@/lib/messages/manage';
import { canAccessClientMessages } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const sendSchema = z.object({
  content: z.string().min(1).max(4000),
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

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const before = url.searchParams.get('before') || null;
  const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10) || 30), 100) : 30;

  const result = await listThreadMessages({
    threadId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    limit,
    before,
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  if (!before) {
    await markThreadRead({
      threadId: id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
  }

  return NextResponse.json({
    success: true,
    thread: { ...result.thread, unreadCount: 0 },
    messages: result.messages,
    hasMore: result.hasMore,
    oldestMessageId: result.oldestMessageId,
  });
}

export async function POST(
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
    const body = sendSchema.parse(await req.json());
    const result = await sendThreadMessage({
      threadId: id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      content: body.content,
      actorName: gate.session.user.name,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(
      { success: true, message: result.message, thread: result.thread },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not send message';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
