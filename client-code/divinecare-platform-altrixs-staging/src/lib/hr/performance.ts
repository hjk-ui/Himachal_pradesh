/**
 * Performance: review cycles (90-day, annual), goals, self review, manager review with sign-off
 * and employee acknowledgment, documentation timeliness counts (no PHI), and corrective action
 * records (HR / leadership only; the employee sees records shared with them to acknowledge).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { addDaysYmd, dateOnlyValue, isHrAdminRole, notesOnTime, ymd } from './standard';
import { assertOrgUser, isMissingTable, loadRoster, type HrCtx } from './server';

export type ReviewRole = 'hr' | 'reviewer' | 'employee' | 'none';

export function reviewRoleFor(ctx: { userId: string; role: string }, review: { userId: string; reviewerId: string | null }, managerUserId?: string | null): ReviewRole {
  if (isHrAdminRole(ctx.role)) return 'hr';
  if (review.reviewerId === ctx.userId || (managerUserId && managerUserId === ctx.userId)) return 'reviewer';
  if (review.userId === ctx.userId) return 'employee';
  return 'none';
}

/** Notes signed on time for a clinician over a period: counts only (no note content, no client). */
export async function documentationMetrics(organizationId: string, userId: string, periodStart: string, periodEnd: string) {
  const staff = await assertOrgUser(organizationId, userId);
  if (!staff) return null;
  const notes = await prisma.progressNote.findMany({
    where: {
      clinicianId: userId,
      OR: [
        { dateOfService: { gte: new Date(`${periodStart}T00:00:00.000Z`), lt: new Date(`${addDaysYmd(periodEnd, 1)}T00:00:00.000Z`) } },
        { dateOfService: null, createdAt: { gte: new Date(`${periodStart}T00:00:00.000Z`), lt: new Date(`${addDaysYmd(periodEnd, 1)}T00:00:00.000Z`) } },
      ],
    },
    select: { dateOfService: true, createdAt: true, workflow: { select: { signedAt: true } } },
    take: 5000,
  });
  const settings = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { noteSignDeadlineHours: true } });
  const deadlineHours = settings?.noteSignDeadlineHours ?? 72;
  const m = notesOnTime(
    notes.map((n) => ({ serviceAt: n.dateOfService ?? n.createdAt, signedAt: n.workflow?.signedAt ?? null })),
    deadlineHours,
  );
  return { ...m, deadlineHours, periodStart, periodEnd };
}

export type ReviewView = {
  id: string;
  userId: string;
  name: string;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewType: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  status: string;
  selfReview: string | null;
  selfSubmittedAt: string | null;
  managerNotes?: string | null;
  managerReview: string | null;
  overallRating: string | null;
  metrics: Record<string, unknown> | null;
  aiDraftUsed: boolean;
  managerSignedAt: string | null;
  employeeAckAt: string | null;
  employeeComment: string | null;
  viewerRole: ReviewRole;
};

export async function listReviews(ctx: HrCtx, opts: { userIds?: string[] } = {}): Promise<ReviewView[]> {
  const roster = await loadRoster(ctx.organizationId, { includeDeactivated: true });
  const byId = new Map(roster.map((p) => [p.userId, p]));
  let rows: Awaited<ReturnType<typeof prisma.hrPerformanceReview.findMany>> = [];
  try {
    rows = await prisma.hrPerformanceReview.findMany({
      where: { organizationId: ctx.organizationId, ...(opts.userIds ? { userId: { in: opts.userIds } } : {}) },
      orderBy: [{ dueOn: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
  return rows
    .map((r) => {
      const viewerRole = reviewRoleFor(ctx, r, byId.get(r.userId)?.managerUserId);
      // The employee sees the manager's review only once it is signed and shared for acknowledgment.
      const employeeView = viewerRole === 'employee';
      const shared = r.status === 'awaiting_ack' || r.status === 'complete';
      return {
        id: r.id,
        userId: r.userId,
        name: byId.get(r.userId)?.name ?? 'Staff',
        reviewerId: r.reviewerId,
        reviewerName: r.reviewerId ? byId.get(r.reviewerId)?.name ?? null : null,
        reviewType: r.reviewType,
        periodStart: ymd(r.periodStart),
        periodEnd: ymd(r.periodEnd),
        dueOn: ymd(r.dueOn),
        status: r.status,
        selfReview: r.selfReview,
        selfSubmittedAt: r.selfSubmittedAt?.toISOString() ?? null,
        ...(employeeView ? {} : { managerNotes: r.managerNotes }),
        managerReview: employeeView && !shared ? null : r.managerReview,
        overallRating: employeeView && !shared ? null : r.overallRating,
        metrics: (r.metrics as Record<string, unknown> | null) ?? null,
        aiDraftUsed: r.aiDraftUsed,
        managerSignedAt: r.managerSignedAt?.toISOString() ?? null,
        employeeAckAt: r.employeeAckAt?.toISOString() ?? null,
        employeeComment: r.employeeComment,
        viewerRole,
      } satisfies ReviewView;
    })
    .filter((r) => r.viewerRole !== 'none');
}

export async function createReview(
  ctx: HrCtx,
  input: { userId: string; reviewerId?: string | null; reviewType: string; periodStart?: string | null; periodEnd?: string | null; dueOn?: string | null },
) {
  const staff = await assertOrgUser(ctx.organizationId, input.userId);
  if (!staff) return { ok: false as const, status: 404, error: 'Staff member not found' };
  if (input.reviewerId) {
    if (input.reviewerId === input.userId) return { ok: false as const, status: 400, error: 'Reviewer cannot be the employee' };
    const ok = await assertOrgUser(ctx.organizationId, input.reviewerId);
    if (!ok) return { ok: false as const, status: 400, error: 'Reviewer must be staff in this practice' };
  }
  const row = await prisma.hrPerformanceReview.create({
    data: {
      organizationId: ctx.organizationId,
      userId: input.userId,
      reviewerId: input.reviewerId ?? null,
      reviewType: input.reviewType,
      periodStart: dateOnlyValue(input.periodStart ?? null),
      periodEnd: dateOnlyValue(input.periodEnd ?? null),
      dueOn: dateOnlyValue(input.dueOn ?? null),
      status: 'self_review',
      createdById: ctx.userId,
    },
  });
  return { ok: true as const, id: row.id };
}

export type ReviewAction =
  | { action: 'self_submit'; selfReview: string }
  | { action: 'save_manager'; managerNotes?: string | null; managerReview?: string | null; overallRating?: string | null; aiDraftUsed?: boolean }
  | { action: 'refresh_metrics' }
  | { action: 'manager_sign' }
  | { action: 'acknowledge'; employeeComment?: string | null }
  | { action: 'reassign'; reviewerId: string | null; dueOn?: string | null };

export async function updateReview(ctx: HrCtx, id: string, input: ReviewAction) {
  const r = await prisma.hrPerformanceReview.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!r) return { ok: false as const, status: 404, error: 'Review not found' };
  const profile = await prisma.staffHrProfile.findUnique({ where: { userId: r.userId }, select: { managerUserId: true } });
  const role = reviewRoleFor(ctx, r, profile?.managerUserId);
  const data: Prisma.HrPerformanceReviewUpdateInput = {};
  switch (input.action) {
    case 'self_submit':
      if (role !== 'employee') return { ok: false as const, status: 403, error: 'Only the employee writes the self review' };
      if (r.selfSubmittedAt) return { ok: false as const, status: 400, error: 'Self review already submitted' };
      data.selfReview = input.selfReview;
      data.selfSubmittedAt = new Date();
      data.status = 'manager_review';
      break;
    case 'save_manager':
      if (role !== 'reviewer' && role !== 'hr') return { ok: false as const, status: 403, error: 'Only the reviewer or HR can edit the review' };
      if (r.managerSignedAt) return { ok: false as const, status: 400, error: 'The review is signed' };
      if (r.userId === ctx.userId) return { ok: false as const, status: 403, error: 'You cannot write your own review' };
      if (input.managerNotes !== undefined) data.managerNotes = input.managerNotes;
      if (input.managerReview !== undefined) data.managerReview = input.managerReview;
      if (input.overallRating !== undefined) data.overallRating = input.overallRating;
      if (input.aiDraftUsed) data.aiDraftUsed = true;
      if (r.status === 'not_started' || r.status === 'self_review') data.status = 'manager_review';
      break;
    case 'refresh_metrics': {
      if (role !== 'reviewer' && role !== 'hr') return { ok: false as const, status: 403, error: 'Forbidden' };
      const end = ymd(r.periodEnd) || ymd(new Date())!;
      const start = ymd(r.periodStart) || addDaysYmd(end, -365);
      const m = await documentationMetrics(ctx.organizationId, r.userId, start, end);
      data.metrics = (m ?? undefined) as Prisma.InputJsonValue | undefined;
      break;
    }
    case 'manager_sign':
      if (role !== 'reviewer' && role !== 'hr') return { ok: false as const, status: 403, error: 'Forbidden' };
      if (r.userId === ctx.userId) return { ok: false as const, status: 403, error: 'You cannot sign your own review' };
      if (!r.managerReview?.trim()) return { ok: false as const, status: 400, error: 'Write the review before signing' };
      data.managerSignedAt = new Date();
      data.managerSignedById = ctx.userId;
      data.status = 'awaiting_ack';
      break;
    case 'acknowledge':
      if (role !== 'employee') return { ok: false as const, status: 403, error: 'Only the employee acknowledges the review' };
      if (!r.managerSignedAt) return { ok: false as const, status: 400, error: 'The review is not ready yet' };
      data.employeeAckAt = new Date();
      data.employeeComment = input.employeeComment?.trim() || null;
      data.status = 'complete';
      break;
    case 'reassign':
      if (role !== 'hr') return { ok: false as const, status: 403, error: 'Only HR can reassign reviews' };
      if (input.reviewerId) {
        if (input.reviewerId === r.userId) return { ok: false as const, status: 400, error: 'Reviewer cannot be the employee' };
        const ok = await assertOrgUser(ctx.organizationId, input.reviewerId);
        if (!ok) return { ok: false as const, status: 400, error: 'Reviewer must be staff in this practice' };
      }
      data.reviewerId = input.reviewerId;
      if (input.dueOn !== undefined) data.dueOn = dateOnlyValue(input.dueOn);
      break;
  }
  await prisma.hrPerformanceReview.update({ where: { id }, data });
  return { ok: true as const, userId: r.userId, action: input.action };
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export async function listGoals(organizationId: string, userIds: string[]) {
  if (!userIds.length) return [];
  try {
    const rows = await prisma.hrGoal.findMany({ where: { organizationId, userId: { in: userIds } }, orderBy: [{ status: 'asc' }, { dueOn: 'asc' }] });
    return rows.map((g) => ({ id: g.id, userId: g.userId, title: g.title, description: g.description, dueOn: ymd(g.dueOn), status: g.status, progressPct: g.progressPct }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Goals: the employee, their manager or HR can add and update. */
export async function saveGoal(
  ctx: HrCtx,
  input: { id?: string | null; userId: string; title?: string; description?: string | null; dueOn?: string | null; status?: string; progressPct?: number },
  canEditFor: (userId: string) => boolean,
) {
  if (!canEditFor(input.userId)) return { ok: false as const, status: 403, error: 'Forbidden' };
  if (input.id) {
    const g = await prisma.hrGoal.findFirst({ where: { id: input.id, organizationId: ctx.organizationId, userId: input.userId } });
    if (!g) return { ok: false as const, status: 404, error: 'Goal not found' };
    await prisma.hrGoal.update({
      where: { id: g.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.dueOn !== undefined ? { dueOn: dateOnlyValue(input.dueOn) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.progressPct !== undefined ? { progressPct: Math.max(0, Math.min(100, Math.round(input.progressPct))) } : {}),
      },
    });
    return { ok: true as const, id: g.id };
  }
  if (!input.title?.trim()) return { ok: false as const, status: 400, error: 'Goal title is required' };
  const staff = await assertOrgUser(ctx.organizationId, input.userId);
  if (!staff) return { ok: false as const, status: 404, error: 'Staff member not found' };
  const row = await prisma.hrGoal.create({
    data: {
      organizationId: ctx.organizationId,
      userId: input.userId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      dueOn: dateOnlyValue(input.dueOn ?? null),
      status: input.status || 'not_started',
      progressPct: input.progressPct ?? 0,
      createdById: ctx.userId,
    },
  });
  return { ok: true as const, id: row.id };
}

// ─── Discipline (restricted) ─────────────────────────────────────────────────

export async function listDiscipline(organizationId: string, opts: { userId?: string; employeeView?: boolean } = {}) {
  try {
    const rows = await prisma.hrDisciplineRecord.findMany({
      where: { organizationId, ...(opts.userId ? { userId: opts.userId } : {}), ...(opts.employeeView ? { sharedWithEmployee: true } : {}) },
      orderBy: { issuedOn: 'desc' },
      take: 200,
    });
    return rows.map((d) => ({
      id: d.id,
      userId: d.userId,
      actionType: d.actionType,
      issuedOn: ymd(d.issuedOn)!,
      summary: d.summary,
      expectations: d.expectations,
      issuedByName: d.issuedByName,
      sharedWithEmployee: d.sharedWithEmployee,
      employeeAckAt: d.employeeAckAt?.toISOString() ?? null,
      employeeComment: d.employeeComment,
      documentId: d.documentId,
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function createDiscipline(
  ctx: HrCtx,
  input: { userId: string; actionType: string; issuedOn: string; summary: string; expectations?: string | null; sharedWithEmployee: boolean },
) {
  if (!isHrAdminRole(ctx.role)) return { ok: false as const, status: 403, error: 'Corrective action records are HR / leadership only' };
  if (input.userId === ctx.userId) return { ok: false as const, status: 403, error: 'You cannot write a corrective action for yourself' };
  const staff = await assertOrgUser(ctx.organizationId, input.userId);
  if (!staff) return { ok: false as const, status: 404, error: 'Staff member not found' };
  const row = await prisma.hrDisciplineRecord.create({
    data: {
      organizationId: ctx.organizationId,
      userId: input.userId,
      actionType: input.actionType,
      issuedOn: dateOnlyValue(input.issuedOn)!,
      summary: input.summary.trim(),
      expectations: input.expectations?.trim() || null,
      issuedById: ctx.userId,
      issuedByName: ctx.name,
      sharedWithEmployee: input.sharedWithEmployee,
    },
  });
  return { ok: true as const, id: row.id };
}

export async function acknowledgeDiscipline(ctx: HrCtx, id: string, comment?: string | null) {
  const d = await prisma.hrDisciplineRecord.findFirst({ where: { id, organizationId: ctx.organizationId, userId: ctx.userId, sharedWithEmployee: true } });
  if (!d) return { ok: false as const, status: 404, error: 'Record not found' };
  if (d.employeeAckAt) return { ok: false as const, status: 400, error: 'Already acknowledged' };
  await prisma.hrDisciplineRecord.update({ where: { id }, data: { employeeAckAt: new Date(), employeeComment: comment?.trim() || null } });
  return { ok: true as const };
}
