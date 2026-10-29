import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { processDueRuns } from '@/lib/marketing/automationService';
import { sendDueCampaigns } from '@/lib/marketing/hubService';
import { withIntegrationCall } from '@/lib/integrations/callLog/record';

export const runtime = 'nodejs';

/** POST: automation tick (waits, no-response triggers, quiet-hours queue, scheduled campaigns). Bearer CRON_SECRET; fails closed. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get('authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const okAuth = Boolean(secret && given && secret.length === given.length && timingSafeEqual(Buffer.from(secret), Buffer.from(given)));
  if (!okAuth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const { runs, campaigns } = await withIntegrationCall(
      { integration: 'cron', operation: 'marketing-automation', direction: 'job' },
      async () => ({ runs: await processDueRuns(), campaigns: await sendDueCampaigns() })
    );
    return NextResponse.json({ success: true, ...runs, campaigns });
  } catch (err) {
    console.error('[marketing cron]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Cron failed' }, { status: 500 });
  }
}
