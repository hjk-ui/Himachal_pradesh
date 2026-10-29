import { prisma } from '@/lib/db/prisma';
import { bad, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { deliveryStatus, getMarketingSettings } from '@/lib/marketing/settings';
import { OPEN_STAGES } from '@/lib/marketing/constants';

export const runtime = 'nodejs';

/** GET /api/marketing: hub header (counts only) + delivery / integration status. */
export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  const { organizationId } = g.gate;
  try {
    const settings = await getMarketingSettings(organizationId);
    const [openLeads, openTasks, reviewsAwaiting, campaignsInReview, postsInReview] = await Promise.all([
      prisma.marketingLead.count({ where: { organizationId, stage: { in: OPEN_STAGES } } }),
      prisma.marketingTask.count({ where: { organizationId, status: 'open' } }),
      prisma.marketingReview.count({ where: { organizationId, responseStatus: { in: ['none', 'draft'] } } }),
      prisma.marketingCampaign.count({ where: { organizationId, status: 'review' } }),
      prisma.marketingSocialPost.count({ where: { organizationId, status: 'review' } }),
    ]);
    return ok({
      counts: { openLeads, openTasks, reviewsAwaiting, campaignsInReview, postsInReview },
      delivery: deliveryStatus(settings.integrationNotes),
      complianceReady: Boolean(settings.physicalAddress),
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2021') return bad('Marketing tables are not on this database yet. Run prisma/migrations/20261022_marketing_suite.sql.', 500);
    return serverError('overview', err);
  }
}
