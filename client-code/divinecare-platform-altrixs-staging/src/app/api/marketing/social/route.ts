import { z } from 'zod';
import { fromResult, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { listSocial, moveSocialPost, saveSocialPost, socialCsv } from '@/lib/marketing/hubService';
import { SOCIAL_CHANNELS } from '@/lib/marketing/constants';

export const runtime = 'nodejs';

/** GET: planner data, or ?format=csv for an export of approved / scheduled posts. */
export async function GET(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const d = await listSocial(g.gate.organizationId);
    if (new URL(req.url).searchParams.get('format') === 'csv') {
      const rows = d.posts.filter((p) => ['approved', 'scheduled', 'exported'].includes(p.status));
      return new Response(socialCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="social-posts.csv"', 'Cache-Control': 'no-store' } });
    }
    return ok({ ...d, channels: SOCIAL_CHANNELS });
  } catch (err) {
    return serverError('social GET', err);
  }
}

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    id: z.string().max(64).optional(),
    channels: z.array(z.string().max(40)).min(1).max(8),
    content: z.string().trim().min(1).max(5000),
    hashtags: z.array(z.string().max(60)).max(20).optional(),
    imagePrompt: z.string().trim().max(1000).nullable().optional(),
    scheduledAt: z.string().max(40).nullable().optional(),
    campaignTag: z.string().trim().max(80).nullable().optional(),
  }),
  z.object({ action: z.literal('move'), id: z.string().max(64), to: z.enum(['draft', 'review', 'approved', 'scheduled', 'posted', 'exported']), note: z.string().max(500).nullable().optional() }),
]);

export async function POST(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const b = schema.parse(await req.json());
    if (b.action === 'save') return fromResult(await saveSocialPost(g.gate.organizationId, b, g.gate.actor), () => ok());
    return fromResult(await moveSocialPost(g.gate.organizationId, b.id, b.to, g.gate.actor, b.note), () => ok());
  } catch (err) {
    return serverError('social POST', err);
  }
}
