import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { aiFeatureEnabled, digestDraft, extractCredentialDraft, ocrDocument, policyAnswer, reviewDraft, writingDraft } from '@/lib/hr/ai';
import { computeExpirations, summarizeExpirations } from '@/lib/hr/expirations';
import { listGoals, reviewRoleFor } from '@/lib/hr/performance';
import { policySections } from '@/lib/hr/policies';
import { auditHr, hrGate, hrJsonError, hrServerError, isMissingTable, loadHrSettings, type HrCtx } from '@/lib/hr/server';
import { isCredentialingRole, isHrAdminRole, ymd, type HrAiFeature } from '@/lib/hr/standard';
import { loadPracticeIdentity } from '@/lib/practice/identity';

export const runtime = 'nodejs';

const FEATURE_FLAG: Record<string, HrAiFeature> = {
  extract: 'aiDocumentExtract',
  writing: 'aiWritingDrafts',
  review: 'aiReviewAssistant',
  policy: 'aiPolicyQa',
  digest: 'aiDigest',
};

async function logAi(ctx: HrCtx, req: Request, feature: string, engine: string, outcome: 'SUCCESS' | 'DENIED' | 'FAILURE' = 'SUCCESS', extra: Record<string, unknown> = {}) {
  // Usage log: feature + engine + outcome only (no document text, no answers).
  await auditHr(ctx, req, 'AI_ACCESS', 'hrAi', null, { feature, engine, ...extra }, outcome);
}

/**
 * POST /api/hr/ai/[feature]: extract | writing | review | policy | digest. Every response is a
 * draft ({ status: 'draft', saved: false }); nothing here writes to the HR record.
 */
export async function POST(req: Request, ctx: { params: Promise<{ feature: string }> }) {
  const { feature } = await ctx.params;
  const flag = FEATURE_FLAG[feature];
  if (!flag) return hrJsonError('Unknown AI feature', 404);
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const settings = await loadHrSettings(g.ctx.organizationId);
  if (!aiFeatureEnabled(settings, flag)) {
    await logAi(g.ctx, req, feature, 'none', 'DENIED', { reason: 'feature_off' });
    return hrJsonError('This AI feature is turned off in HR settings', 403);
  }
  try {
    switch (feature) {
      case 'extract': {
        if (!isCredentialingRole(g.ctx.role)) return hrJsonError('Forbidden', 403);
        const form = await req.formData();
        const file = form.get('file');
        let text = String(form.get('text') || '');
        if (file instanceof File && file.size > 0) {
          if (file.size > 5 * 1024 * 1024) return hrJsonError('Use a file under 5 MB', 400);
          const ocr = await ocrDocument(Buffer.from(await file.arrayBuffer()));
          if (ocr.ok === false) {
            if (!text) return hrJsonError(ocr.error, 503);
          } else {
            text = `${ocr.text}\n${text}`;
          }
        }
        if (!text.trim()) return hrJsonError('Upload a document or paste its text', 400);
        const draft = await extractCredentialDraft(text);
        await logAi(g.ctx, req, feature, draft.engine);
        return NextResponse.json({ success: true, draft });
      }
      case 'writing': {
        if (!isHrAdminRole(g.ctx.role)) return hrJsonError('Forbidden', 403);
        const body = z
          .object({
            kind: z.enum(['job_description', 'offer_letter']),
            jobTitle: z.string().trim().min(1).max(120),
            role: z.string().max(40).optional().nullable(),
            location: z.string().max(120).optional().nullable(),
            program: z.string().max(80).optional().nullable(),
            workerType: z.string().max(12).optional().nullable(),
            payType: z.string().max(20).optional().nullable(),
            payText: z.string().max(120).optional().nullable(),
            candidateName: z.string().max(120).optional().nullable(),
            startDate: z.string().max(10).optional().nullable(),
            supervisorTitle: z.string().max(120).optional().nullable(),
            extra: z.string().max(1000).optional().nullable(),
          })
          .parse(await req.json());
        const identity = await loadPracticeIdentity(g.ctx.organizationId).catch(() => null);
        const practiceName = identity?.name ?? null;
        const draft = await writingDraft({ ...body, practiceName });
        await logAi(g.ctx, req, feature, draft.engine, 'SUCCESS', { kind: body.kind });
        return NextResponse.json({ success: true, draft });
      }
      case 'review': {
        const body = z.object({ reviewId: z.string().min(1).max(128) }).parse(await req.json());
        const review = await prisma.hrPerformanceReview.findFirst({ where: { id: body.reviewId, organizationId: g.ctx.organizationId } });
        if (!review) return hrJsonError('Review not found', 404);
        const profile = await prisma.staffHrProfile.findUnique({ where: { userId: review.userId }, select: { managerUserId: true } });
        const role = reviewRoleFor(g.ctx, review, profile?.managerUserId);
        if ((role !== 'reviewer' && role !== 'hr') || review.userId === g.ctx.userId) {
          await logAi(g.ctx, req, feature, 'none', 'DENIED', { reason: 'not_reviewer' });
          return hrJsonError('Only the reviewer or HR can use the review assistant', 403);
        }
        const goals = await listGoals(g.ctx.organizationId, [review.userId]);
        const metrics = (review.metrics as Record<string, number> | null) ?? null;
        const draft = await reviewDraft({
          reviewType: review.reviewType,
          periodLabel: [ymd(review.periodStart), ymd(review.periodEnd)].filter(Boolean).join(' to ') || 'this period',
          goals: goals.map((x) => ({ title: x.title, status: x.status, progressPct: x.progressPct, description: x.description })),
          managerNotes: review.managerNotes,
          selfReview: review.selfReview,
          metrics,
        });
        await logAi(g.ctx, req, feature, draft.engine, 'SUCCESS', { reviewId: review.id });
        return NextResponse.json({ success: true, draft });
      }
      case 'policy': {
        const body = z.object({ question: z.string().trim().min(3).max(500) }).parse(await req.json());
        const sections = await policySections(g.ctx.organizationId);
        const draft = await policyAnswer(body.question, sections);
        await logAi(g.ctx, req, feature, draft.engine, 'SUCCESS', { citations: draft.data.citations.length });
        return NextResponse.json({ success: true, draft });
      }
      case 'digest': {
        if (!isHrAdminRole(g.ctx.role)) return hrJsonError('Forbidden', 403);
        const { items, today } = await computeExpirations(g.ctx.organizationId, { attentionOnly: true });
        const s = summarizeExpirations(items);
        let timeOffPending = 0;
        let changeRequestsPending = 0;
        let reviewsDue = 0;
        try {
          [timeOffPending, changeRequestsPending, reviewsDue] = await Promise.all([
            prisma.hrTimeOffRequest.count({ where: { organizationId: g.ctx.organizationId, status: 'pending' } }),
            prisma.hrProfileChangeRequest.count({ where: { organizationId: g.ctx.organizationId, status: 'pending' } }),
            prisma.hrPerformanceReview.count({ where: { organizationId: g.ctx.organizationId, status: { not: 'complete' }, dueOn: { lte: new Date(`${today}T12:00:00.000Z`) } } }),
          ]);
        } catch (err) {
          if (!isMissingTable(err)) throw err;
        }
        const licenses = items.filter((i) => i.source === 'credential' && i.category === 'Professional license');
        const facts = {
          weekLabel: `Week of ${today}`,
          licensesExpiring: licenses.filter((i) => i.status === 'due_30' || i.status === 'due_60').length,
          licensesExpired: licenses.filter((i) => i.status === 'expired').length,
          credentialsDue: items.filter((i) => (i.source === 'credential' && i.category !== 'Professional license') || i.source === 'compliance').length,
          exclusionChecksDue: new Set(items.filter((i) => i.source === 'exclusion').map((i) => i.userId)).size,
          caqhDue: s.caqhDue,
          trainingsOverdue: s.trainingsOverdue,
          onboardingTasksOverdue: s.tasksOverdue,
          timeOffPending,
          reviewsDue,
          changeRequestsPending,
        };
        const draft = await digestDraft(facts);
        await logAi(g.ctx, req, feature, draft.engine);
        return NextResponse.json({ success: true, draft, facts, top: items.filter((i) => i.status === 'expired' || i.status === 'due_30').slice(0, 10) });
      }
    }
    return hrJsonError('Unknown AI feature', 404);
  } catch (err) {
    if (err instanceof z.ZodError) return hrJsonError('Check the request', 400);
    await logAi(g.ctx, req, feature, 'none', 'FAILURE');
    return hrServerError(`ai ${feature}`, err);
  }
}
