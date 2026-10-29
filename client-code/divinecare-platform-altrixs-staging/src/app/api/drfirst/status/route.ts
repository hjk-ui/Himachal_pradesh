import { NextRequest, NextResponse } from 'next/server';
import { probeConnection } from '@/lib/services/drfirstRcopiaService';
import { requireDrFirstCaller } from '../_lib/access';

export const dynamic = 'force-dynamic';

/** GET /api/drfirst/status — connection probe for prescribers and ADMIN (status only, no response body). */
export async function GET(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true });
  if (g.response) return g.response;
  try {
    const status = await probeConnection();
    return NextResponse.json({
      success: true,
      data: {
        demo: status.demo,
        engineUrl: status.engineUrl,
        practice: status.practice,
        ok: status.result?.ok ?? null,
        status: status.result?.status ?? null,
        error: status.result?.error ?? null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to check DrFirst connection status' }, { status: 500 });
  }
}
