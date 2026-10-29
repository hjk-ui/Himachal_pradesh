/**
 * Automation runner (Prisma): starts runs on triggers, advances them with the pure engine
 * (automation.ts) and applies the resulting actions. Sends go through sendMarketingMessage (consent
 * gate). Runs that wait are picked up by processDueRuns (cron /api/marketing/public/cron, or the
 * "Run due automations" button).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  advanceRun,
  newRun,
  noResponseDue,
  RECIPES,
  triggerMatches,
  type Action,
  type RunState,
  type RunSubject,
  type Step,
  type Trigger,
  type TriggerType,
  type Workflow,
} from './automation';
import { getMarketingSettings, practiceInfo } from './settings';
import { sendMarketingMessage } from './send';

export type TriggerEvent = {
  type: TriggerType;
  leadId?: string;
  contactId?: string;
  eventId?: string;
  reviewId?: string;
  source?: string | null;
  toStage?: string | null;
  rating?: number | null;
};

function toWorkflow(w: { id: string; name: string; trigger: unknown; steps: unknown; active: boolean }): Workflow {
  return { id: w.id, name: w.name, trigger: w.trigger as Trigger, steps: (w.steps as Step[]) ?? [], active: w.active };
}

function toState(r: { stepIndex: number; status: string; waitUntil: Date | null; startedAt: Date; log: unknown }): RunState {
  return {
    stepIndex: r.stepIndex,
    status: r.status as RunState['status'],
    waitUntil: r.waitUntil,
    startedAt: r.startedAt,
    log: Array.isArray(r.log) ? (r.log as RunState['log']) : [],
  };
}

async function buildSubject(
  organizationId: string,
  run: { leadId: string | null; contactId: string | null; eventId: string | null; reviewId: string | null },
): Promise<RunSubject | null> {
  const practice = await practiceInfo(organizationId);
  const base = { practiceName: practice.name, practicePhone: practice.phone ?? '' };
  if (run.leadId) {
    const l = await prisma.marketingLead.findFirst({ where: { id: run.leadId, organizationId } });
    if (!l) return null;
    return {
      kind: 'lead',
      id: l.id,
      stage: l.stage,
      lastInboundAt: l.lastInboundAt,
      recipient: { ...l, isClient: l.stage === 'converted' },
      vars: { ...base, firstName: l.firstName },
    };
  }
  if (run.contactId) {
    const c = await prisma.marketingContact.findFirst({ where: { id: run.contactId, organizationId } });
    if (!c) return null;
    const ev = run.eventId ? await prisma.communityEvent.findFirst({ where: { id: run.eventId, organizationId }, select: { title: true, startsAt: true } }) : null;
    return {
      kind: 'contact',
      id: c.id,
      eventStartsAt: ev?.startsAt ?? null,
      recipient: { ...c, isClient: c.kind === 'client_authorized' || Boolean(c.clientId) },
      vars: {
        ...base,
        firstName: c.name.split(/\s+/)[0] ?? '',
        eventName: ev?.title ?? '',
        eventDate: ev ? ev.startsAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }) : '',
        reviewLink: '',
      },
    };
  }
  if (run.reviewId) return { kind: 'review', id: run.reviewId, recipient: null, vars: base };
  return null;
}

async function applyActions(
  organizationId: string,
  run: { id: string; leadId: string | null; contactId: string | null },
  actions: Action[],
  subject: RunSubject,
  workflowName: string,
) {
  const { addLeadTask, updateLead, addActivity } = await import('./leadService');
  for (const a of actions) {
    try {
      if (a.type === 'send') {
        if (run.leadId) {
          const { sendLeadMessage } = await import('./leadService');
          await sendLeadMessage(organizationId, run.leadId, { channel: a.channel, body: a.body, subject: a.subject }, null, { runId: run.id });
        } else if (run.contactId && subject.recipient) {
          await sendMarketingMessage({ organizationId, channel: a.channel, purpose: a.purpose, recipient: subject.recipient, body: a.body, subject: a.subject, contactId: run.contactId, runId: run.id });
        }
      } else if (a.type === 'skipped_send') {
        if (run.leadId) await addActivity(organizationId, run.leadId, 'system', `Automation "${workflowName}": ${a.channel === 'sms' ? 'text' : 'email'} not sent (${a.reason.replace(/_/g, ' ')}).`, null);
      } else if (a.type === 'create_task' || a.type === 'notify_staff') {
        const lead = run.leadId ? await prisma.marketingLead.findFirst({ where: { id: run.leadId, organizationId }, select: { assignedToId: true } }) : null;
        await addLeadTask(
          organizationId,
          run.leadId,
          { title: a.type === 'notify_staff' ? `Notice: ${a.message}` : a.title, dueAt: a.type === 'create_task' ? a.dueAt : new Date(), assignedToId: lead?.assignedToId ?? null, source: 'automation' },
          null,
        );
      } else if (a.type === 'assign' && run.leadId && a.userId) {
        await updateLead(organizationId, run.leadId, { assignedToId: a.userId }, null, { fromAutomation: true });
      } else if (a.type === 'move_stage' && run.leadId) {
        await updateLead(organizationId, run.leadId, { stage: a.stage }, null, { fromAutomation: true });
      }
    } catch (err) {
      console.error('[marketing automation] action failed', a.type, err instanceof Error ? err.message : err);
    }
  }
}

/** Advance one run now and persist. */
export async function processRun(runId: string, now = new Date()) {
  const run = await prisma.marketingWorkflowRun.findUnique({ where: { id: runId } });
  if (!run || run.status === 'completed' || run.status === 'stopped') return null;
  const wf = await prisma.marketingWorkflow.findUnique({ where: { id: run.workflowId } });
  if (!wf || !wf.active) {
    await prisma.marketingWorkflowRun.update({ where: { id: run.id }, data: { status: 'stopped', finishedAt: now, waitUntil: null } });
    return null;
  }
  const subject = await buildSubject(run.organizationId, run);
  if (!subject) {
    await prisma.marketingWorkflowRun.update({ where: { id: run.id }, data: { status: 'stopped', finishedAt: now, waitUntil: null } });
    return null;
  }
  const settings = await getMarketingSettings(run.organizationId);
  const { state, actions } = advanceRun(toWorkflow(wf), toState(run), subject, {
    now,
    timeZone: settings.timeZone,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    physicalAddress: settings.physicalAddress,
  });
  await prisma.marketingWorkflowRun.update({
    where: { id: run.id },
    data: {
      stepIndex: state.stepIndex,
      status: state.status,
      waitUntil: state.waitUntil,
      log: state.log.slice(-60) as unknown as Prisma.InputJsonValue,
      finishedAt: state.status === 'completed' || state.status === 'stopped' ? now : null,
    },
  });
  await applyActions(run.organizationId, run, actions, subject, wf.name);
  return state;
}

/** Start matching active workflows for an event (one live run per workflow + subject). */
export async function fireTrigger(organizationId: string, event: TriggerEvent, now = new Date()) {
  const workflows = await prisma.marketingWorkflow.findMany({ where: { organizationId, active: true } });
  const started: string[] = [];
  for (const w of workflows) {
    if (!triggerMatches(w.trigger as Trigger, { type: event.type, source: event.source, toStage: event.toStage, rating: event.rating })) continue;
    const existing = await prisma.marketingWorkflowRun.findFirst({
      where: {
        workflowId: w.id,
        status: { in: ['active', 'waiting'] },
        leadId: event.leadId ?? null,
        contactId: event.contactId ?? null,
        reviewId: event.reviewId ?? null,
      },
      select: { id: true },
    });
    if (existing) continue;
    const st = newRun(now);
    const run = await prisma.marketingWorkflowRun.create({
      data: {
        organizationId,
        workflowId: w.id,
        leadId: event.leadId ?? null,
        contactId: event.contactId ?? null,
        eventId: event.eventId ?? null,
        reviewId: event.reviewId ?? null,
        stepIndex: st.stepIndex,
        status: st.status,
        startedAt: now,
        log: [],
      },
    });
    started.push(run.id);
    await processRun(run.id, now);
  }
  return started;
}

/** Cron / manual tick: advance due runs, start no-response workflows, resend quiet-hours queue. */
export async function processDueRuns(opts: { organizationId?: string; now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const due = await prisma.marketingWorkflowRun.findMany({
    where: {
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      OR: [{ status: 'active' }, { status: 'waiting', waitUntil: { lte: now } }],
    },
    orderBy: { updatedAt: 'asc' },
    take: opts.limit ?? 200,
    select: { id: true },
  });
  let advanced = 0;
  for (const r of due) {
    await processRun(r.id, now).catch((e) => console.error('[marketing automation] run', e instanceof Error ? e.message : e));
    advanced += 1;
  }

  // no_response triggers
  const nrWorkflows = await prisma.marketingWorkflow.findMany({
    where: { active: true, ...(opts.organizationId ? { organizationId: opts.organizationId } : {}) },
  });
  let started = 0;
  for (const w of nrWorkflows) {
    const t = w.trigger as Trigger;
    if (t.type !== 'no_response' || !t.hours) continue;
    const cutoff = new Date(now.getTime() - t.hours * 3600000);
    const leads = await prisma.marketingLead.findMany({
      where: { organizationId: w.organizationId, stage: { in: ['new', 'contacted', 'screening', 'insurance_verified', 'scheduled'] }, lastContactAt: { lte: cutoff } },
      select: { id: true, stage: true, lastContactAt: true, lastInboundAt: true },
      take: 200,
    });
    for (const l of leads) {
      if (!noResponseDue(l, t.hours, now)) continue;
      const prior = await prisma.marketingWorkflowRun.findFirst({ where: { workflowId: w.id, leadId: l.id, startedAt: { gte: l.lastContactAt! } }, select: { id: true } });
      if (prior) continue;
      const run = await prisma.marketingWorkflowRun.create({ data: { organizationId: w.organizationId, workflowId: w.id, leadId: l.id, status: 'active', startedAt: now, log: [] } });
      await processRun(run.id, now);
      started += 1;
    }
  }

  // Manual messages queued for quiet hours
  const { resendQuietHoursQueue } = await import('./hubService');
  const resent = await resendQuietHoursQueue(opts.organizationId, now).catch(() => 0);
  return { advanced, started, resent };
}

/** Install a pre-built recipe (inactive until staff turn it on). */
export async function installRecipe(organizationId: string, key: string, userId: string) {
  const r = RECIPES.find((x) => x.key === key);
  if (!r) return { ok: false as const, status: 404, error: 'Recipe not found.' };
  const exists = await prisma.marketingWorkflow.findFirst({ where: { organizationId, recipeKey: key } });
  if (exists) return { ok: false as const, status: 409, error: 'That recipe is already installed.' };
  const w = await prisma.marketingWorkflow.create({
    data: {
      organizationId,
      name: r.name,
      recipeKey: r.key,
      trigger: r.trigger as unknown as Prisma.InputJsonValue,
      steps: r.steps as unknown as Prisma.InputJsonValue,
      active: false,
      createdById: userId,
    },
  });
  return { ok: true as const, workflow: w };
}
