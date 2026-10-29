import {
  patientGet,
  patientOptions,
  PATIENT_CORS,
} from '@/patient/infrastructure/http/handler';
import { verifyPatientThreadAccess } from '@/patient/application/messages/service';
import { subscribeToThread } from '@/lib/messages/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return patientOptions();
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const handler = patientGet(
    async ({ req: request, ctx: patient }) => {
      // Confirm patient has access to this conversation
      await verifyPatientThreadAccess(patient, id);

      const encoder = new TextEncoder();
      let cleanup: (() => void) | null = null;

      const stream = new ReadableStream({
        start(controller) {
          let isClosed = false;

          const send = (event: string, data: unknown) => {
            if (isClosed) return;
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
              );
            } catch {
              isClosed = true;
              safeCleanup();
            }
          };

          // Initial connection greeting
          send('connected', {
            conversationId: id,
            connectedAt: new Date().toISOString(),
          });

          // Subscribe to real-time events for this conversation
          const unsubscribe = subscribeToThread(id, (evt) => {
            // Strictly exclude internal clinician notes from reaching the patient stream
            if (evt.senderType === 'CLINICIAN_NOTE' || !evt.patientMessage) {
              return;
            }
            send('message', evt.patientMessage);
          });

          // Heartbeat ping every 15s to keep mobile connection alive through carrier NAT / reverse proxy
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
          request.signal.addEventListener('abort', safeCleanup);
        },
        cancel() {
          if (cleanup) cleanup();
        },
      });

      return new Response(stream, {
        headers: {
          ...PATIENT_CORS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    },
    ['patient-conversation-stream', 60]
  );

  return handler(req);
}
