import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessMarketing, listMarketingLeads } from '@/lib/marketing/manage';
import { listMarketingItems } from '@/lib/marketing/store';
import { OPEN_LEAD_STAGES } from '@/lib/marketing/constants';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessMarketing(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const [leads, reviews, campaigns] = await Promise.all([
    listMarketingLeads(gate.organizationId, { includeClosed: true }),
    listMarketingItems<{ rating?: number }>(gate.organizationId, 'review'),
    listMarketingItems(gate.organizationId, 'campaign'),
  ]);

  const last30 = leads.filter((l) => new Date(l.createdAt).getTime() >= since);
  const converted = leads.filter((l) => l.stage === 'Converted to client');
  const speeds = last30
    .map((l) => {
      const created = new Date(l.createdAt).getTime();
      const updated = new Date(l.updatedAt).getTime();
      return Math.max(0, (updated - created) / (1000 * 60 * 60));
    })
    .sort((a, b) => a - b);
  const medianSpeed =
    speeds.length === 0
      ? null
      : speeds.length % 2
        ? speeds[(speeds.length - 1) / 2]
        : (speeds[speeds.length / 2 - 1] + speeds[speeds.length / 2]) / 2;

  const ratings = reviews.map((r) => Number(r.rating || 0)).filter((n) => n > 0);
  const avgRating =
    ratings.length === 0 ? null : ratings.reduce((a, b) => a + b, 0) / ratings.length;

  const sources: Record<string, number> = {};
  for (const l of last30) {
    sources[l.source] = (sources[l.source] || 0) + 1;
  }

  return NextResponse.json({
    success: true,
    kpis: {
      leads30: last30.length,
      converted: converted.length,
      medianSpeedHours: medianSpeed,
      avgReviewRating: avgRating,
      openLeads: leads.filter((l) => OPEN_LEAD_STAGES.includes(l.stage)).length,
      campaigns: campaigns.length,
    },
    sources,
    emptyLeads30: last30.length === 0,
  });
}
