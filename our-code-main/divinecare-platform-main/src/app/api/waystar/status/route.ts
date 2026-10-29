import { NextResponse } from 'next/server';
import { getConnectionStatus } from '@/lib/services/waystarSftpService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getConnectionStatus();
    return NextResponse.json({
      success: true,
      ...status,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[waystar-status] error:', err);
    return NextResponse.json({ error: 'Failed to read Waystar connector status' }, { status: 500 });
  }
}
