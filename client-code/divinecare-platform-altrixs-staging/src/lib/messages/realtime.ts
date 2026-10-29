import { EventEmitter } from 'node:events';

export type RealtimeSenderType = 'FRONT_OFFICE' | 'PATIENT' | 'CLINICIAN_NOTE';

export type RealtimeStaffMessage = {
  id: string;
  threadId: string;
  senderType: 'front-office' | 'patient' | 'clinician-note';
  senderId: 'staff' | 'client' | 'clinician-note';
  senderName: string;
  content: string;
  read: boolean;
  createdAt: string;
  timestamp: string;
};

export type RealtimePatientMessage = {
  id: string;
  threadId: string;
  senderRole: 'patient' | 'clinician' | string;
  senderName: string;
  body: string;
  read: boolean;
  createdAt: string;
};

export type RealtimeMessageEvent = {
  type: 'new_message';
  threadId: string;
  senderType: RealtimeSenderType;
  staffMessage: RealtimeStaffMessage;
  patientMessage?: RealtimePatientMessage;
};

type GlobalRealtime = {
  __altrixsRealtimeEmitter?: EventEmitter;
};

const g = globalThis as unknown as GlobalRealtime;

if (!g.__altrixsRealtimeEmitter) {
  const emitter = new EventEmitter();
  // Allow high numbers of concurrent thread listeners across active connections
  emitter.setMaxListeners(2000);
  g.__altrixsRealtimeEmitter = emitter;
}

const emitter = g.__altrixsRealtimeEmitter;

function getChannel(threadId: string) {
  return `thread:${threadId}`;
}

/**
 * Publishes a real-time message to all active stream subscribers for this thread.
 */
export function publishRealtimeMessage(event: RealtimeMessageEvent) {
  try {
    const channel = getChannel(event.threadId);
    emitter.emit(channel, event);

    // Emit to Socket.io subscribers
    try {
      const io = (globalThis as any).__altrixsSocketIO;
      if (io) {
        io.to(`thread:${event.threadId}`).emit('new_message', event);
      }
    } catch {
      // Ignore if socket io server not initialized
    }

    // Optional: Pusher broadcast if environment variables are configured
    const pusherAppId = process.env.PUSHER_APP_ID;
    const pusherKey = process.env.PUSHER_KEY;
    const pusherSecret = process.env.PUSHER_SECRET;
    const pusherCluster = process.env.PUSHER_CLUSTER;

    if (pusherAppId && pusherKey && pusherSecret && pusherCluster) {
      // Fire-and-forget pusher push via HTTP API to avoid blocking
      pushToPusher(pusherAppId, pusherKey, pusherSecret, pusherCluster, event).catch(() => {
        // Silent failure if Pusher network issue
      });
    }
  } catch (err) {
    console.error('[realtime:publish] Failed to emit message:', err);
  }
}

/**
 * Subscribes to new messages in a specific thread.
 * Returns an unsubscribe callback.
 */
export function subscribeToThread(
  threadId: string,
  listener: (event: RealtimeMessageEvent) => void
): () => void {
  const channel = getChannel(threadId);
  emitter.on(channel, listener);
  return () => {
    emitter.off(channel, listener);
  };
}

/**
 * Lightweight helper to broadcast to Pusher HTTP API if keys are provided in .env
 */
async function pushToPusher(
  appId: string,
  key: string,
  secret: string,
  cluster: string,
  event: RealtimeMessageEvent
) {
  const crypto = await import('node:crypto');
  const body = JSON.stringify({
    name: 'new_message',
    channels: [`thread-${event.threadId}`],
    data: JSON.stringify(event),
  });

  const bodyMd5 = crypto.createHash('md5').update(body).digest('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const path = `/apps/${appId}/events`;
  const queryString = `auth_key=${key}&auth_timestamp=${timestamp}&auth_version=1.0&body_md5=${bodyMd5}`;
  const authSignature = crypto
    .createHmac('sha256', secret)
    .update(`POST\n${path}\n${queryString}`)
    .digest('hex');

  const url = `https://api-${cluster}.pusher.com${path}?${queryString}&auth_signature=${authSignature}`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
