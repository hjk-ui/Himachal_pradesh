import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  listClientMessages,
  markClientMessagesRead,
  sendStaffMessage,
} from '@/lib/messages/manage';
import { canAccessClientMessages } from '@/lib/clients/orgScope';

const sendSchema = z.object({
  content: z.string().min(1).max(4000),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ clientId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientMessages(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { clientId } = await ctx.params;
  const result = await listClientMessages({
    clientId,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  await markClientMessagesRead({
    clientId,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });

  return NextResponse.json({
    success: true,
    messages: result.messages,
    clientName: result.clientName,
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { clientId } = await ctx.params;
    if (!canAccessClientMessages(gate.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const body = sendSchema.parse(await req.json());
    const result = await sendStaffMessage({
      clientId,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      content: body.content,
      actorName: gate.session.user.name,
    });
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, message: result.message }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not send message';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
