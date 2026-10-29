import { bad, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { prisma } from '@/lib/db/prisma';
import { suggestLeadReplies } from '@/lib/marketing/ai';

export const runtime = 'nodejs';

/** POST: AI suggested replies (lead text redacted before the model; drafts only). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await marketingGate('leads');
  if (!g.ok) return g.res;
  try {
    const { id } = await ctx.params;
    const lead = await prisma.marketingLead.findFirst({ where: { id, organizationId: g.gate.organizationId }, select: { stage: true, firstName: true, lastName: true } });
    if (!lead) return bad('Lead not found.', 404);
    const last = await prisma.marketingMessage.findFirst({ where: { leadId: id, organizationId: g.gate.organizationId, direction: 'inbound' }, orderBy: { createdAt: 'desc' }, select: { body: true } });
    const draft = await suggestLeadReplies(g.gate.organizationId, g.gate.userId, { ...lead, lastInbound: last?.body ?? null });
    return ok({ draft });
  } catch (err) {
    return serverError('suggest', err);
  }
}
