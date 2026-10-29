import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { bad, marketingGate, ok, serverError } from '@/lib/marketing/http';
import { checkReviewResponse, REVIEW_ISSUE_TEXT } from '@/lib/marketing/reviewGuard';
import { draftReviewReply } from '@/lib/marketing/ai';
import { practiceInfo } from '@/lib/marketing/settings';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

/** POST: AI (or template) HIPAA-safe reply draft. */
export async function POST(_req: Request, ctx: Ctx) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const { id } = await ctx.params;
    const r = await prisma.marketingReview.findFirst({ where: { id, organizationId: g.gate.organizationId } });
    if (!r) return bad('Review not found.', 404);
    const draft = await draftReviewReply(g.gate.organizationId, g.gate.userId, r);
    await prisma.marketingReview.update({ where: { id }, data: { responseDraft: draft.data.reply, responseStatus: 'draft' } });
    return ok({ draft });
  } catch (err) {
    return serverError('review draft', err);
  }
}

const schema = z.object({ action: z.enum(['save', 'approve', 'posted']), text: z.string().trim().max(1000).optional() });

/** PATCH: save / approve / mark posted. Every reply text passes the HIPAA guard. */
export async function PATCH(req: Request, ctx: Ctx) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const { id } = await ctx.params;
    const b = schema.parse(await req.json());
    const r = await prisma.marketingReview.findFirst({ where: { id, organizationId: g.gate.organizationId } });
    if (!r) return bad('Review not found.', 404);
    const text = (b.text ?? r.responseDraft ?? '').trim();
    if (!text) return bad('Write a reply first.');
    const practice = await practiceInfo(g.gate.organizationId);
    const issues = checkReviewResponse(text, { reviewerName: r.authorName, allowedContacts: [practice.phone, practice.email] });
    if (issues.length) {
      return bad(`HIPAA check: ${REVIEW_ISSUE_TEXT[issues[0].code]} ("${issues[0].match}")`, 400, { issues: issues.map((i) => ({ ...i, text: REVIEW_ISSUE_TEXT[i.code] })) });
    }
    if (b.action === 'posted' && r.responseStatus !== 'approved') return bad('Approve the reply before marking it posted.');
    const status = b.action === 'save' ? 'draft' : b.action === 'approve' ? 'approved' : 'posted';
    await prisma.marketingReview.update({
      where: { id },
      data: { responseDraft: text, responseStatus: status, ...(status === 'posted' ? { respondedAt: new Date(), respondedById: g.gate.userId } : {}) },
    });
    await writeAuditLog({ action: `MARKETING_REVIEW_REPLY_${status.toUpperCase()}`, actorUserId: g.gate.userId, actorRole: g.gate.role, organizationId: g.gate.organizationId, resourceType: 'marketing_review', resourceId: id }).catch(() => {});
    return ok({ status });
  } catch (err) {
    return serverError('review PATCH', err);
  }
}
