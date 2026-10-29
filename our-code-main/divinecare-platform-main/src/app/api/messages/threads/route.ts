import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getOrCreateThreadForClient, listMessageThreads } from '@/lib/messages/manage';
import { canAccessClientMessages } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const createThreadSchema = z.object({
  clientId: z.string().min(1),
  topic: z.enum(['scheduling', 'billing', 'general', 'clinical', 'rx-refill']).optional(),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientMessages(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const threads = await listMessageThreads({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    return NextResponse.json({ success: true, threads });
  } catch (err) {
    console.error('[messages/threads GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to load threads' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientMessages(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = createThreadSchema.parse(await req.json());
    const result = await getOrCreateThreadForClient({
      clientId: body.clientId,
      topic: body.topic,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      actorName: gate.session.user.name,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, thread: result.thread }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not create or find thread';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
