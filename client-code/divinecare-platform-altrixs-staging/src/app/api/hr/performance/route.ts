import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createReview, listGoals, listReviews } from '@/lib/hr/performance';
import { auditHr, hrGate, hrJsonError, hrServerError, loadHrSettings, loadRoster } from '@/lib/hr/server';
import { REVIEW_TYPES, isHrAdminRole } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/** GET /api/hr/performance: reviews + goals (HR all; a manager their reports; staff their own). */
export async function GET(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  try {
    const admin = isHrAdminRole(g.ctx.role);
    const roster = await loadRoster(g.ctx.organizationId);
    const team = roster.filter((p) => p.managerUserId === g.ctx.userId || p.clinicalSupervisorUserId === g.ctx.userId).map((p) => p.userId);
    const userIds = admin ? undefined : [g.ctx.userId, ...team];
    const [reviews, settings] = await Promise.all([listReviews(g.ctx, { userIds }), loadHrSettings(g.ctx.organizationId)]);
    const goals = await listGoals(g.ctx.organizationId, admin ? roster.map((p) => p.userId) : (userIds as string[]));
    if (admin) await auditHr(g.ctx, req, 'LIST', 'hrPerformance', null, { reviews: reviews.length });
    return NextResponse.json({
      success: true,
      viewer: { userId: g.ctx.userId, admin, team },
      reviews,
      goals,
      people: roster.filter((p) => admin || team.includes(p.userId) || p.userId === g.ctx.userId).map((p) => ({ userId: p.userId, name: p.name, role: p.role, managerUserId: p.managerUserId })),
      reviewTypes: REVIEW_TYPES,
      aiReviewAssistant: settings.aiReviewAssistant,
    });
  } catch (err) {
    return hrServerError('performance', err);
  }
}

const createSchema = z.object({
  userId: z.string().min(1).max(128),
  reviewerId: z.string().max(128).optional().nullable(),
  reviewType: z.enum(REVIEW_TYPES.map((t) => t.key) as unknown as [string, ...string[]]),
  periodStart: z.string().trim().max(10).optional().nullable(),
  periodEnd: z.string().trim().max(10).optional().nullable(),
  dueOn: z.string().trim().max(10).optional().nullable(),
});

/** POST: start a review cycle for one person (HR, or the person's manager). */
export async function POST(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the review details', 400);
  }
  try {
    const admin = isHrAdminRole(g.ctx.role);
    if (!admin) {
      const roster = await loadRoster(g.ctx.organizationId);
      const person = roster.find((p) => p.userId === body.userId);
      if (!person || person.managerUserId !== g.ctx.userId) return hrJsonError('Only HR or the manager can start a review', 403);
      body.reviewerId = g.ctx.userId;
    }
    if (body.userId === g.ctx.userId) return hrJsonError('You cannot start your own review', 403);
    const result = await createReview(g.ctx, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'hrPerformanceReview', result.id, { staffUserId: body.userId, reviewType: body.reviewType });
    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (err) {
    return hrServerError('review create', err);
  }
}
