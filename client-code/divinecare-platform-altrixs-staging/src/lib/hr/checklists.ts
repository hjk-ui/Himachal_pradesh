/**
 * Onboarding / offboarding workflows: configurable templates (defaults in standard.ts), one
 * checklist per person per kind, tasks with owners and due dates, and system actions
 * (deactivate the Altrixs account, caseload handoff by COUNT, policy acknowledgments).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import {
  DEFAULT_OFFBOARDING_ITEMS,
  DEFAULT_ONBOARDING_ITEMS,
  addDaysYmd,
  buildChecklistTasks,
  caseloadTaskLabel,
  checklistProgress,
  dateOnlyValue,
  isHrAdminRole,
  ymd,
  type ChecklistItem,
} from './standard';
import { ensureProfile, isMissingTable, loadRoster, type HrCtx } from './server';

export type ChecklistKind = 'onboarding' | 'offboarding';

export type TemplateView = { id: string | null; kind: ChecklistKind; name: string; roles: string[]; items: ChecklistItem[]; builtIn: boolean };

export function builtInTemplate(kind: ChecklistKind): TemplateView {
  return {
    id: null,
    kind,
    name: kind === 'onboarding' ? 'Standard onboarding' : 'Standard offboarding',
    roles: [],
    items: kind === 'onboarding' ? DEFAULT_ONBOARDING_ITEMS : DEFAULT_OFFBOARDING_ITEMS,
    builtIn: true,
  };
}

export async function listTemplates(organizationId: string, kind?: ChecklistKind): Promise<TemplateView[]> {
  let rows: Awaited<ReturnType<typeof prisma.hrChecklistTemplate.findMany>> = [];
  try {
    rows = await prisma.hrChecklistTemplate.findMany({ where: { organizationId, active: true, ...(kind ? { kind } : {}) }, orderBy: { name: 'asc' } });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  const custom = rows.map((r) => ({ id: r.id, kind: r.kind as ChecklistKind, name: r.name, roles: r.roles, items: (r.items as unknown as ChecklistItem[]) ?? [], builtIn: false }));
  const kinds: ChecklistKind[] = kind ? [kind] : ['onboarding', 'offboarding'];
  return [...kinds.map(builtInTemplate), ...custom];
}

export async function saveTemplate(
  ctx: HrCtx,
  input: { id?: string | null; kind: ChecklistKind; name: string; roles: string[]; items: ChecklistItem[]; active?: boolean },
) {
  const items = input.items.map((i, idx) => ({ ...i, key: i.key || `item_${idx + 1}` }));
  if (input.id) {
    const existing = await prisma.hrChecklistTemplate.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
    if (!existing) return { ok: false as const, status: 404, error: 'Template not found' };
    await prisma.hrChecklistTemplate.update({
      where: { id: input.id },
      data: { name: input.name, roles: input.roles, items: items as unknown as Prisma.InputJsonValue, active: input.active ?? true, updatedById: ctx.userId },
    });
    return { ok: true as const, id: input.id };
  }
  const row = await prisma.hrChecklistTemplate.create({
    data: { organizationId: ctx.organizationId, kind: input.kind, name: input.name, roles: input.roles, items: items as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
  });
  return { ok: true as const, id: row.id };
}

/** Pick the template: explicit id, else a custom template for the role, else the built-in one. */
export async function resolveTemplate(organizationId: string, kind: ChecklistKind, role: string, templateId?: string | null) {
  const all = await listTemplates(organizationId, kind);
  if (templateId) return all.find((t) => t.id === templateId) ?? null;
  return all.find((t) => !t.builtIn && t.roles.includes(role)) ?? all.find((t) => !t.builtIn && t.roles.length === 0) ?? all[0];
}

/** Assigned ACTIVE clients for a departing clinician: a count only, never names. */
export async function assignedClientCount(organizationId: string, userId: string): Promise<number> {
  return prisma.client.count({ where: { AND: [clientOrgFilter(organizationId), { assignedToId: userId, status: 'ACTIVE' }] } });
}

export async function startChecklist(
  ctx: HrCtx,
  input: { userId: string; kind: ChecklistKind; startOn: string; templateId?: string | null; separationType?: string | null; reason?: string | null },
) {
  const roster = await loadRoster(ctx.organizationId, { includeDeactivated: true });
  const person = roster.find((p) => p.userId === input.userId);
  if (!person) return { ok: false as const, status: 404, error: 'Staff member not found' };
  const dup = await prisma.hrChecklist.findFirst({ where: { organizationId: ctx.organizationId, userId: input.userId, kind: input.kind, status: 'active' } });
  if (dup) return { ok: false as const, status: 409, error: `An ${input.kind} checklist is already open for ${person.name}` };
  const template = await resolveTemplate(ctx.organizationId, input.kind, person.role, input.templateId);
  if (!template) return { ok: false as const, status: 404, error: 'Template not found' };
  const startOn = ymd(input.startOn);
  if (!startOn) return { ok: false as const, status: 400, error: 'Invalid date' };

  const subject = { userId: person.userId, role: person.role, workerType: person.workerType, managerUserId: person.managerUserId };
  const tasks = buildChecklistTasks(template.items, subject, startOn);
  let meta: Record<string, unknown> | null = null;
  if (input.kind === 'offboarding') {
    const count = await assignedClientCount(ctx.organizationId, person.userId);
    meta = { separationType: input.separationType ?? null, assignedClientCount: count };
    for (const t of tasks) if (t.systemAction === 'caseload_reassign') t.label = caseloadTaskLabel(count);
  }

  const checklist = await prisma.$transaction(async (tx) => {
    const c = await tx.hrChecklist.create({
      data: {
        organizationId: ctx.organizationId,
        userId: person.userId,
        kind: input.kind,
        templateId: template.id,
        templateName: template.name,
        startOn: dateOnlyValue(startOn)!,
        meta: (meta ?? undefined) as Prisma.InputJsonValue | undefined,
        createdById: ctx.userId,
      },
    });
    if (tasks.length) {
      await tx.hrChecklistTask.createMany({
        data: tasks.map((t) => ({
          organizationId: ctx.organizationId,
          checklistId: c.id,
          userId: person.userId,
          key: t.key,
          label: t.label,
          category: t.category,
          ownerType: t.ownerType,
          assigneeUserId: t.assigneeUserId,
          dueOn: dateOnlyValue(t.dueOn),
          sortOrder: t.sortOrder,
          requiresAck: t.requiresAck,
          requiresUpload: t.requiresUpload,
          systemAction: t.systemAction,
          note: t.note,
        })),
      });
    }
    return c;
  });

  const profile = await ensureProfile(ctx.organizationId, person.userId);
  if (profile) {
    if (input.kind === 'onboarding') {
      await prisma.staffHrProfile.update({
        where: { id: profile.id },
        data: { hrStatus: 'Onboarding', ...(profile.hireDate ? {} : { hireDate: dateOnlyValue(startOn) }) },
      });
      // 90-day review is part of onboarding (HR can change the reviewer / date later).
      const hasReview = await prisma.hrPerformanceReview.findFirst({ where: { organizationId: ctx.organizationId, userId: person.userId, reviewType: 'ninety_day' } });
      if (!hasReview) {
        await prisma.hrPerformanceReview.create({
          data: {
            organizationId: ctx.organizationId,
            userId: person.userId,
            reviewerId: person.managerUserId,
            reviewType: 'ninety_day',
            periodStart: dateOnlyValue(startOn),
            periodEnd: dateOnlyValue(addDaysYmd(startOn, 90)),
            dueOn: dateOnlyValue(addDaysYmd(startOn, 90)),
            createdById: ctx.userId,
          },
        });
      }
    } else {
      await prisma.staffHrProfile.update({
        where: { id: profile.id },
        data: {
          hrStatus: 'Offboarding',
          terminationDate: dateOnlyValue(startOn),
          ...(input.separationType ? { separationType: input.separationType } : {}),
        },
      });
    }
  }
  return { ok: true as const, id: checklist.id, taskCount: tasks.length, meta };
}

export type ChecklistTaskView = {
  id: string;
  key: string;
  label: string;
  category: string;
  ownerType: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueOn: string | null;
  status: string;
  completedAt: string | null;
  completedByName: string | null;
  note: string | null;
  requiresAck: boolean;
  acknowledgedAt: string | null;
  requiresUpload: boolean;
  documentId: string | null;
  systemAction: string | null;
};

export type ChecklistView = {
  id: string;
  userId: string;
  staffName: string;
  jobTitle: string;
  kind: string;
  templateName: string;
  status: string;
  startOn: string;
  meta: Record<string, unknown> | null;
  progress: { done: number; total: number; pct: number };
  overdue: number;
  tasks: ChecklistTaskView[];
  accountStatus: string;
  liveAssignedClientCount?: number;
};

export async function listChecklists(
  organizationId: string,
  opts: { kind?: ChecklistKind; userId?: string; userIds?: string[]; status?: string; today: string },
): Promise<ChecklistView[]> {
  let rows;
  try {
    rows = await prisma.hrChecklist.findMany({
      where: {
        organizationId,
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.userId ? { userId: opts.userId } : {}),
        ...(opts.userIds ? { userId: { in: opts.userIds } } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: [{ status: 'asc' }, { startOn: 'desc' }],
      take: 200,
    });
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
  if (!rows.length) return [];
  const tasks = await prisma.hrChecklistTask.findMany({
    where: { organizationId, checklistId: { in: rows.map((r) => r.id) } },
    orderBy: [{ sortOrder: 'asc' }],
  });
  const roster = await loadRoster(organizationId, { includeDeactivated: true });
  const byId = new Map(roster.map((p) => [p.userId, p]));
  const out: ChecklistView[] = [];
  for (const r of rows) {
    const mine = tasks.filter((t) => t.checklistId === r.id);
    const view: ChecklistView = {
      id: r.id,
      userId: r.userId,
      staffName: byId.get(r.userId)?.name ?? 'Staff',
      jobTitle: byId.get(r.userId)?.jobTitle ?? '',
      kind: r.kind,
      templateName: r.templateName,
      status: r.status,
      startOn: ymd(r.startOn)!,
      meta: (r.meta as Record<string, unknown> | null) ?? null,
      progress: checklistProgress(mine),
      overdue: mine.filter((t) => t.status === 'open' && t.dueOn && ymd(t.dueOn)! < opts.today).length,
      accountStatus: byId.get(r.userId)?.accountStatus ?? 'ACTIVE',
      tasks: mine.map((t) => ({
        id: t.id,
        key: t.key,
        label: t.label,
        category: t.category,
        ownerType: t.ownerType,
        assigneeUserId: t.assigneeUserId,
        assigneeName: t.assigneeUserId ? byId.get(t.assigneeUserId)?.name ?? null : null,
        dueOn: ymd(t.dueOn),
        status: t.status,
        completedAt: t.completedAt?.toISOString() ?? null,
        completedByName: t.completedByName,
        note: t.note,
        requiresAck: t.requiresAck,
        acknowledgedAt: t.acknowledgedAt?.toISOString() ?? null,
        requiresUpload: t.requiresUpload,
        documentId: t.documentId,
        systemAction: t.systemAction,
      })),
    };
    if (r.kind === 'offboarding' && r.status === 'active' && mine.some((t) => t.systemAction === 'caseload_reassign')) {
      view.liveAssignedClientCount = await assignedClientCount(organizationId, r.userId);
    }
    out.push(view);
  }
  return out;
}

/** Who can act on a task: HR / leadership any; the assignee; the employee on their own employee task. */
export function canActOnTask(ctx: { userId: string; role: string }, task: { ownerType: string; assigneeUserId: string | null; userId: string }) {
  if (isHrAdminRole(ctx.role)) return true;
  if (task.assigneeUserId && task.assigneeUserId === ctx.userId) return true;
  return task.ownerType === 'employee' && task.userId === ctx.userId;
}

export async function updateChecklistTask(
  ctx: HrCtx,
  taskId: string,
  input: { status?: 'open' | 'done' | 'skipped'; note?: string | null; acknowledge?: boolean; documentId?: string | null; assigneeUserId?: string | null; dueOn?: string | null; performAction?: boolean },
) {
  const task = await prisma.hrChecklistTask.findFirst({ where: { id: taskId, organizationId: ctx.organizationId } });
  if (!task) return { ok: false as const, status: 404, error: 'Task not found' };
  if (!canActOnTask(ctx, task)) return { ok: false as const, status: 403, error: 'This task is assigned to someone else' };
  const hrAdmin = isHrAdminRole(ctx.role);
  if ((input.assigneeUserId !== undefined || input.dueOn !== undefined || input.status === 'skipped') && !hrAdmin) {
    return { ok: false as const, status: 403, error: 'Only HR can reassign, reschedule or skip tasks' };
  }
  if (input.assigneeUserId) {
    const ok = await prisma.user.findFirst({ where: { id: input.assigneeUserId, organizationId: ctx.organizationId }, select: { id: true } });
    if (!ok) return { ok: false as const, status: 400, error: 'Assignee must be staff in this practice' };
  }
  if (input.documentId) {
    const doc = await prisma.hrDocument.findFirst({ where: { id: input.documentId, organizationId: ctx.organizationId, userId: task.userId }, select: { id: true } });
    if (!doc) return { ok: false as const, status: 400, error: 'Document not found for this person' };
  }

  let actionResult: string | null = null;
  if (input.status === 'done' && task.status !== 'done') {
    if (task.requiresAck && !task.acknowledgedAt && !input.acknowledge && task.ownerType === 'employee' && task.userId === ctx.userId) {
      return { ok: false as const, status: 400, error: 'Check the acknowledgment box first' };
    }
    if (task.systemAction === 'deactivate_user') {
      const user = await prisma.user.findFirst({ where: { id: task.userId, organizationId: ctx.organizationId }, select: { status: true } });
      if (user?.status !== 'DEACTIVATED') {
        if (!input.performAction) {
          return { ok: false as const, status: 409, error: 'The Altrixs account is still active. Deactivate it first (administrators: use "Deactivate now").' };
        }
        if (!['ADMIN', 'PRACTICE_DIRECTOR'].includes(ctx.role)) {
          return { ok: false as const, status: 403, error: 'Only an administrator or practice director can deactivate accounts' };
        }
        if (task.userId === ctx.userId) return { ok: false as const, status: 400, error: 'You cannot deactivate your own account' };
        const { updateStaffUser } = await import('@/lib/staff/manage');
        const res = await updateStaffUser(task.userId, ctx.userId, ctx.organizationId, { status: 'DEACTIVATED' }, { actorRole: ctx.role });
        if (!res.ok) return { ok: false as const, status: 400, error: res.error || 'Could not deactivate the account' };
        actionResult = 'account_deactivated';
      } else {
        actionResult = 'account_already_deactivated';
      }
    }
    if (task.systemAction === 'caseload_reassign') {
      const count = await assignedClientCount(ctx.organizationId, task.userId);
      if (count > 0 && !input.note?.trim()) {
        return { ok: false as const, status: 409, error: `${count} active client${count === 1 ? ' is' : 's are'} still assigned. Reassign them, or add a note explaining the plan.` };
      }
      actionResult = `assigned_clients_${count}`;
    }
  }

  const now = new Date();
  const data: Prisma.HrChecklistTaskUpdateInput = {};
  if (input.status) {
    data.status = input.status;
    if (input.status === 'done') {
      data.completedAt = now;
      data.completedById = ctx.userId;
      data.completedByName = ctx.name;
    } else {
      data.completedAt = null;
      data.completedById = null;
      data.completedByName = null;
    }
  }
  if (input.acknowledge && task.requiresAck && task.userId === ctx.userId) data.acknowledgedAt = now;
  if (input.note !== undefined) data.note = input.note?.trim() || null;
  if (input.documentId !== undefined) data.documentId = input.documentId;
  if (input.assigneeUserId !== undefined) data.assigneeUserId = input.assigneeUserId;
  if (input.dueOn !== undefined) data.dueOn = dateOnlyValue(input.dueOn);
  await prisma.hrChecklistTask.update({ where: { id: task.id }, data });

  // Policy acknowledgment: record against the active policy of that kind (if uploaded).
  if (input.acknowledge && task.systemAction === 'policy_ack' && task.userId === ctx.userId) {
    const kind = task.key.replace(/^ack_/, '').replace('conduct', 'code_of_conduct');
    const policy = await prisma.hrPolicyDocument.findFirst({ where: { organizationId: ctx.organizationId, kind, active: true }, orderBy: { updatedAt: 'desc' } });
    if (policy) {
      await prisma.hrPolicyAcknowledgment.upsert({
        where: { policyId_userId_version: { policyId: policy.id, userId: ctx.userId, version: policy.version } },
        update: {},
        create: { organizationId: ctx.organizationId, policyId: policy.id, userId: ctx.userId, version: policy.version },
      });
    }
  }

  // Close the checklist when nothing is open.
  const open = await prisma.hrChecklistTask.count({ where: { checklistId: task.checklistId, status: 'open' } });
  const checklist = await prisma.hrChecklist.findUnique({ where: { id: task.checklistId } });
  if (checklist && open === 0 && checklist.status === 'active') {
    await prisma.hrChecklist.update({ where: { id: checklist.id }, data: { status: 'complete', completedAt: now } });
    const profile = await prisma.staffHrProfile.findUnique({ where: { userId: checklist.userId } });
    if (profile && profile.organizationId === ctx.organizationId) {
      await prisma.staffHrProfile.update({ where: { id: profile.id }, data: { hrStatus: checklist.kind === 'onboarding' ? 'Active' : 'Terminated' } });
    }
  } else if (checklist && open > 0 && checklist.status === 'complete') {
    await prisma.hrChecklist.update({ where: { id: checklist.id }, data: { status: 'active', completedAt: null } });
  }
  return { ok: true as const, checklistId: task.checklistId, userId: task.userId, systemAction: task.systemAction, actionResult };
}

export async function cancelChecklist(ctx: HrCtx, id: string) {
  const c = await prisma.hrChecklist.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!c) return { ok: false as const, status: 404, error: 'Checklist not found' };
  await prisma.hrChecklist.update({ where: { id }, data: { status: 'cancelled' } });
  if (c.kind === 'offboarding') {
    const profile = await prisma.staffHrProfile.findUnique({ where: { userId: c.userId } });
    if (profile && profile.organizationId === ctx.organizationId && profile.hrStatus === 'Offboarding') {
      await prisma.staffHrProfile.update({ where: { id: profile.id }, data: { hrStatus: 'Active', terminationDate: null } });
    }
  }
  return { ok: true as const, userId: c.userId, kind: c.kind };
}
