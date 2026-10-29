import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  createGoal,
  createPto,
  createReminder,
  createRequiredTraining,
  createReview,
  dashboardSnapshot,
  getEmployeeRecord,
  getHrSettings,
  hrFieldAccess,
  listChecklists,
  listGoals,
  listPto,
  listReminders,
  listRequiredTrainings,
  listReviews,
  saveEmployeeRecord,
  saveHrSettings,
  setChecklistStatus,
  setChecklistTaskDone,
  setPtoStatus,
  setReminderStatus,
  startChecklist,
} from '@/lib/hr/workspace';

export const runtime = 'nodejs';

function forbid(role: string) {
  return !canAccessPath(role as never, '/dashboard/hr');
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (forbid(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const view = url.searchParams.get('view') || 'dashboard';
  const access = hrFieldAccess(gate.role);

  if (view === 'dashboard') {
    const snap = await dashboardSnapshot(gate.organizationId);
    return NextResponse.json({ success: true, ...snap, access });
  }
  if (view === 'reminders') {
    return NextResponse.json({
      success: true,
      items: await listReminders(gate.organizationId),
      access,
    });
  }
  if (view === 'checklists') {
    const type = url.searchParams.get('type') as 'onboarding' | 'offboarding' | null;
    return NextResponse.json({
      success: true,
      items: await listChecklists(gate.organizationId, type || undefined),
      access,
    });
  }
  if (view === 'pto') {
    return NextResponse.json({
      success: true,
      items: await listPto(gate.organizationId),
      access,
    });
  }
  if (view === 'reviews') {
    return NextResponse.json({
      success: true,
      items: await listReviews(gate.organizationId),
      goals: await listGoals(gate.organizationId),
      access,
    });
  }
  if (view === 'trainings') {
    return NextResponse.json({
      success: true,
      items: await listRequiredTrainings(gate.organizationId),
      access,
    });
  }
  if (view === 'settings') {
    return NextResponse.json({
      success: true,
      settings: await getHrSettings(gate.organizationId),
      access,
    });
  }
  if (view === 'employee') {
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    const record = await getEmployeeRecord(gate.organizationId, userId);
    const redacted = { ...record };
    if (!access.canSeeCompensation) redacted.compensationNote = '';
    if (!access.canSeeDiscipline) redacted.correctiveNote = '';
    if (!access.canSeePersonal) redacted.personalNote = '';
    return NextResponse.json({ success: true, record: redacted, access });
  }

  return NextResponse.json({ success: false, error: 'Unknown view' }, { status: 400 });
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reminder-create'), title: z.string().min(1) }),
  z.object({
    action: z.literal('reminder-status'),
    id: z.string(),
    status: z.enum(['done', 'dismissed', 'open']),
  }),
  z.object({
    action: z.literal('checklist-start'),
    type: z.enum(['onboarding', 'offboarding']),
    staffUserId: z.string(),
    staffName: z.string(),
  }),
  z.object({
    action: z.literal('checklist-task'),
    checklistId: z.string(),
    taskId: z.string(),
    done: z.boolean(),
  }),
  z.object({
    action: z.literal('checklist-status'),
    checklistId: z.string(),
    status: z.enum(['In progress', 'Complete', 'Cancelled']),
  }),
  z.object({
    action: z.literal('pto-create'),
    staffUserId: z.string(),
    staffName: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal('pto-status'),
    id: z.string(),
    status: z.enum(['approved', 'denied', 'pending']),
  }),
  z.object({
    action: z.literal('review-create'),
    staffUserId: z.string(),
    staffName: z.string(),
    summary: z.string().optional(),
  }),
  z.object({ action: z.literal('goal-create'), title: z.string(), staffName: z.string() }),
  z.object({
    action: z.literal('training-create'),
    title: z.string(),
    hours: z.number().optional(),
  }),
  z.object({ action: z.literal('settings-save'), patch: z.record(z.string(), z.unknown()) }),
  z.object({
    action: z.literal('employee-save'),
    userId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
]);

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (forbid(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const access = hrFieldAccess(gate.role);
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  }
  const body = parsed.data;

  switch (body.action) {
    case 'reminder-create':
      return NextResponse.json({
        success: true,
        item: await createReminder(gate.organizationId, body.title),
      });
    case 'reminder-status':
      return NextResponse.json(
        await setReminderStatus(gate.organizationId, body.id, body.status)
      );
    case 'checklist-start':
      return NextResponse.json({
        success: true,
        item: await startChecklist(gate.organizationId, body),
      });
    case 'checklist-task':
      return NextResponse.json(
        await setChecklistTaskDone(
          gate.organizationId,
          body.checklistId,
          body.taskId,
          body.done
        )
      );
    case 'checklist-status':
      return NextResponse.json(
        await setChecklistStatus(gate.organizationId, body.checklistId, body.status)
      );
    case 'pto-create':
      return NextResponse.json({
        success: true,
        item: await createPto(gate.organizationId, {
          staffUserId: body.staffUserId,
          staffName: body.staffName,
          startDate: body.startDate,
          endDate: body.endDate,
          reason: body.reason || '',
        }),
      });
    case 'pto-status':
      if (!access.canApprovePto) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.json(await setPtoStatus(gate.organizationId, body.id, body.status));
    case 'review-create':
      return NextResponse.json({
        success: true,
        item: await createReview(gate.organizationId, body),
      });
    case 'goal-create':
      return NextResponse.json({
        success: true,
        item: await createGoal(gate.organizationId, body),
      });
    case 'training-create':
      return NextResponse.json({
        success: true,
        item: await createRequiredTraining(gate.organizationId, body),
      });
    case 'settings-save':
      if (!access.canManageSettings) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.json({
        success: true,
        settings: await saveHrSettings(gate.organizationId, body.patch),
      });
    case 'employee-save': {
      const patch = { ...body.patch };
      if (!access.canSeeCompensation) delete patch.compensationNote;
      if (!access.canSeeDiscipline) delete patch.correctiveNote;
      if (!access.canSeePersonal) delete patch.personalNote;
      return NextResponse.json({
        success: true,
        record: await saveEmployeeRecord(gate.organizationId, body.userId, patch),
        access,
      });
    }
    default:
      return NextResponse.json({ success: false, error: 'Unhandled' }, { status: 400 });
  }
}
