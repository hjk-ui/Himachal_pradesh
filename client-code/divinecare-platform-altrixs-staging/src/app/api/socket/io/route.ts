import { NextResponse } from 'next/server';
import { getSocketIOServer } from '@/lib/socket/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    // Attempt to access underlying Node HTTP server if attached to request
    const nodeReq = req as unknown as { socket?: { server?: any } };
    if (nodeReq.socket?.server) {
      getSocketIOServer(nodeReq.socket.server);
    }
    return NextResponse.json({
      status: 'online',
      service: 'Altrixs Socket.io Gateway',
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Socket initialization failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
