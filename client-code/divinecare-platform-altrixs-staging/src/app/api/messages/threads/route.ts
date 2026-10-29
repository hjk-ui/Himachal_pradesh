import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getOrCreateThreadForClient, listMessageThreads } from '@/lib/messages/manage';
import { canAccessClientMessages } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const createThreadSchema = z.object({
  clientId: z.string().min(1),
  topic: z.enum(['scheduling', 'billing', 'general', 'clinical', 'rx-refill']).optional(),
});

export async function GET(req: Request) {
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
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'messageThread',
      metadata: {
        count: threads.length,
        threadIds: threads.slice(0, 50).map((t) => t.id),
        clientIds: [...new Set(threads.map((t) => t.clientId))].slice(0, 50),
      },
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
      if (result.status === 403 || result.status === 404) {
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'messageThread', resourceId: body.clientId, patientId: body.clientId, outcome: 'DENIED', metadata: { status: result.status } });
      }
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'messageThread',
      resourceId: result.thread.id,
      patientId: result.thread.clientId,
      metadata: { topic: result.thread.topic, getOrCreate: true },
    });
    return NextResponse.json({ success: true, thread: result.thread }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not create or find thread';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
