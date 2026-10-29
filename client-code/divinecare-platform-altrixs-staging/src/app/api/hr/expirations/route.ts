import { NextResponse } from 'next/server';
import { computeExpirations, summarizeExpirations } from '@/lib/hr/expirations';
import { auditHr, hrGate, hrServerError } from '@/lib/hr/server';

export const runtime = 'nodejs';

/** GET /api/hr/expirations?all=1: every dated item with its status (HR, leadership, Office Manager). */
export async function GET(req: Request) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  try {
    const all = new URL(req.url).searchParams.get('all') === '1';
    const { items, today, settings } = await computeExpirations(g.ctx.organizationId, { attentionOnly: !all });
    await auditHr(g.ctx, req, 'LIST', 'hrExpirations', null, { count: items.length });
    return NextResponse.json({
      success: true,
      today,
      windows: { dueSoonDays: settings.dueSoonDays, urgentDays: settings.urgentDays },
      summary: summarizeExpirations(items),
      items,
    });
  } catch (err) {
    return hrServerError('expirations', err);
  }
}
