import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientMessages } from '@/lib/clients/orgScope';
import { getThreadForActor } from '@/lib/messages/manage';
import { subscribeToThread } from '@/lib/messages/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const thread = await getThreadForActor(id, {
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });

  if (!thread) {
    return NextResponse.json({ success: false, error: 'Thread not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;

      const send = (event: string, data: unknown) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          isClosed = true;
          safeCleanup();
        }
      };

      // Initial connection greeting
      send('connected', { threadId: id, connectedAt: new Date().toISOString() });

      // Subscribe to real-time events for this thread
      const unsubscribe = subscribeToThread(id, (evt) => {
        send('message', evt);
      });

      // Keepalive heartbeat every 15s to keep proxy/cloud tunnels open
      const heartbeat = setInterval(() => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          isClosed = true;
          safeCleanup();
        }
      }, 15000);

      const safeCleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        if (!isClosed) {
          isClosed = true;
          try {
            controller.close();
          } catch {}
        }
      };

      cleanup = safeCleanup;
      req.signal.addEventListener('abort', safeCleanup);
    },
    cancel() {
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
