import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { campaignAction, listCampaigns, previewAudience, saveCampaign } from '@/lib/marketing/hubService';
import { prisma } from '@/lib/db/prisma';
import { CONTACT_KINDS } from '@/lib/marketing/constants';

export const runtime = 'nodejs';

export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const org = g.gate.organizationId;
    const [campaigns, partners, events, tagRows] = await Promise.all([
      listCampaigns(org),
      prisma.communityPartner.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.communityEvent.findMany({ where: { organizationId: org }, select: { id: true, title: true, startsAt: true }, orderBy: { startsAt: 'desc' }, take: 60 }),
      prisma.marketingContact.findMany({ where: { organizationId: org }, select: { tags: true }, take: 3000 }),
    ]);
    const tags = Array.from(new Set(tagRows.flatMap((t) => t.tags))).sort();
    return ok({ campaigns, partners, events: events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt.toISOString() })), tags, kinds: CONTACT_KINDS });
  } catch (err) {
    return serverError('campaigns GET', err);
  }
}

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    id: z.string().max(64).optional(),
    name: z.string().trim().min(2).max(120),
    channel: z.enum(['email', 'sms']),
    audience: z.unknown(),
    subjectA: z.string().trim().max(200).nullable().optional(),
    subjectB: z.string().trim().max(200).nullable().optional(),
    body: z.string().trim().min(1).max(10000),
    scheduledAt: z.string().max(40).nullable().optional(),
  }),
  z.object({ action: z.literal('preview'), audience: z.unknown(), channel: z.enum(['email', 'sms']) }),
  z.object({ action: z.enum(['submit', 'approve', 'reject', 'send', 'schedule']), id: z.string().max(64) }),
]);

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = schema.parse(await req.json());
    const org = g.gate.organizationId;
    if (b.action === 'save') return fromResult(await saveCampaign(org, b, g.gate.actor), (r) => ok({ campaignId: r.ok ? r.campaign.id : null }));
    if (b.action === 'preview') return fromResult(await previewAudience(org, b.audience, b.channel), (r) => ok({ ...r }));
    return fromResult(await campaignAction(org, b.id, b.action, g.gate.actor), (r) => ok({ ...r }));
  } catch (err) {
    return serverError('campaigns POST', err);
  }
}
