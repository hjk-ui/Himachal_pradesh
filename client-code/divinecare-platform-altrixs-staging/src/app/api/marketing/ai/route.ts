import { z } from 'zod';
import { marketingGate, ok, serverError } from '@/lib/marketing/http';
import { contentCalendar, draftLandingCopy, draftPressRelease, draftSocial, growthInsights } from '@/lib/marketing/ai';
import { analytics } from '@/lib/marketing/hubService';
import { createPrRelease } from '@/lib/pr/manage';

export const runtime = 'nodejs';

const schema = z.discriminatedUnion('feature', [
  z.object({ feature: z.literal('socialCaption'), topic: z.string().trim().min(2).max(500), channels: z.array(z.string().max(40)).max(8).default([]) }),
  z.object({ feature: z.literal('pressRelease'), headline: z.string().trim().min(4).max(200), facts: z.string().trim().min(10).max(4000), quote: z.string().trim().max(800).optional(), spokesperson: z.string().trim().max(120).optional(), city: z.string().trim().max(80).optional(), contact: z.string().trim().max(200).optional(), saveDraft: z.boolean().optional() }),
  z.object({ feature: z.literal('landingCopy'), service: z.string().trim().min(2).max(120), location: z.string().trim().max(120).optional(), audience: z.string().trim().max(200).optional() }),
  z.object({ feature: z.literal('contentCalendar'), month: z.number().int().min(1).max(12) }),
  z.object({ feature: z.literal('growthInsights') }),
]);

/** POST /api/marketing/ai: growth assistant drafts (always drafts; a person approves before use). */
export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = schema.parse(await req.json());
    const { organizationId, userId } = g.gate;
    if (b.feature === 'socialCaption') return ok({ draft: await draftSocial(organizationId, userId, b) });
    if (b.feature === 'pressRelease') {
      const draft = await draftPressRelease(organizationId, userId, b);
      // Saved as a PR draft (status draft) so it enters the existing press release review flow
      const saved = b.saveDraft ? await createPrRelease(organizationId, { title: b.headline, body: draft.data.body, status: 'draft' }) : null;
      return ok({ draft, releaseId: saved?.ok ? saved.release.id : null });
    }
    if (b.feature === 'landingCopy') return ok({ draft: await draftLandingCopy(organizationId, userId, b) });
    if (b.feature === 'contentCalendar') return ok({ draft: await contentCalendar(organizationId, userId, b.month) });
    const a = await analytics(organizationId, 30);
    return ok({ draft: await growthInsights(organizationId, userId, a.aggregates) });
  } catch (err) {
    return serverError('ai', err);
  }
}
