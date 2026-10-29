/**
 * Lead pipeline service (Prisma). Leads are PHI once they share health information: they stay in
 * Altrixs, every access is org-scoped, and lead notes are minimum necessary (clinicalTermsIn).
 * Dedupe against clients returns a flag and the matched FIELDS only, never the client.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { createClient } from '@/lib/clients/manage';
import { createAppointment } from '@/lib/appointments/manage';
import { LEAD_STAGES, leadSourceLabel, leadStageLabel, OPEN_STAGES } from './constants';
import { bestMatch, canMoveStage, clinicalTermsIn, nextFurthestStage, phoneKey, speedToLeadStatus, type DedupeMatch } from './leads';
import { toUsE164 } from './consent';
import { getMarketingSettings } from './settings';
import { sendMarketingMessage, type MarketingSendResult } from './send';
import { fireTrigger } from './automationService';

export type Actor = { userId: string; role: string; name?: string | null };

export type LeadDTO = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  source: string;
  sourceLabel: string;
  sourceDetail: string | null;
  partnerId: string | null;
  eventId: string | null;
  stage: string;
  stageLabel: string;
  stageChangedAt: string;
  assignedToId: string | null;
  assignedToName: string | null;
  serviceInterest: string | null;
  locationName: string | null;
  insurance: string | null;
  preferredContact: string | null;
  contactConsent: boolean;
  smsConsent: boolean;
  smsOptedOut: boolean;
  emailConsent: boolean;
  emailOptedOut: boolean;
  notes: string | null;
  possibleClientMatch: boolean;
  createdAt: string;
  firstResponseAt: string | null;
  lastContactAt: string | null;
  lastInboundAt: string | null;
  intakeScheduledAt: string | null;
  convertedAt: string | null;
  convertedClientId: string | null;
  lostReason: string | null;
  speed: { minutes: number; responded: boolean; overdue: boolean };
  unread: number;
  openTasks: number;
};

type LeadRow = NonNullable<Awaited<ReturnType<typeof prisma.marketingLead.findFirst>>>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toLeadDTO(l: LeadRow, extra: { assignee?: string | null; unread?: number; openTasks?: number; target: number; now: Date }): LeadDTO {
  return {
    id: l.id,
    firstName: l.firstName,
    lastName: l.lastName,
    phone: l.phone,
    email: l.email,
    dateOfBirth: l.dateOfBirth ? l.dateOfBirth.toISOString().slice(0, 10) : null,
    source: l.source,
    sourceLabel: leadSourceLabel(l.source),
    sourceDetail: l.sourceDetail,
    partnerId: l.partnerId,
    eventId: l.eventId,
    stage: l.stage,
    stageLabel: leadStageLabel(l.stage),
    stageChangedAt: l.stageChangedAt.toISOString(),
    assignedToId: l.assignedToId,
    assignedToName: extra.assignee ?? null,
    serviceInterest: l.serviceInterest,
    locationName: l.locationName,
    insurance: l.insurance,
    preferredContact: l.preferredContact,
    contactConsent: l.contactConsent,
    smsConsent: l.smsConsent,
    smsOptedOut: Boolean(l.smsOptOutAt),
    emailConsent: l.emailConsent,
    emailOptedOut: Boolean(l.emailOptOutAt),
    notes: l.notes,
    possibleClientMatch: l.possibleClientMatch,
    createdAt: l.createdAt.toISOString(),
    firstResponseAt: iso(l.firstResponseAt),
    lastContactAt: iso(l.lastContactAt),
    lastInboundAt: iso(l.lastInboundAt),
    intakeScheduledAt: iso(l.intakeScheduledAt),
    convertedAt: iso(l.convertedAt),
    convertedClientId: l.convertedClientId,
    lostReason: l.lostReason,
    speed: speedToLeadStatus({ createdAt: l.createdAt, firstResponseAt: l.firstResponseAt }, extra.target, extra.now),
    unread: extra.unread ?? 0,
    openTasks: extra.openTasks ?? 0,
  };
}

async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (!uniq.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name || u.email || 'Staff']));
}

export async function listLeads(organizationId: string, opts: { includeClosed?: boolean; q?: string; assignedToId?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const settings = await getMarketingSettings(organizationId);
  const since = new Date(now.getTime() - 120 * 24 * 3600000);
  const q = opts.q?.trim();
  const leads = await prisma.marketingLead.findMany({
    where: {
      organizationId,
      ...(opts.includeClosed ? { OR: [{ stage: { in: OPEN_STAGES } }, { stageChangedAt: { gte: since } }] } : { stage: { in: OPEN_STAGES } }),
      ...(opts.assignedToId ? { assignedToId: opts.assignedToId } : {}),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { firstName: { contains: q, mode: 'insensitive' as const } },
                  { lastName: { contains: q, mode: 'insensitive' as const } },
                  ...(phoneKey(q) || q.replace(/\D/g, '').length >= 4 ? [{ phone: { contains: q.replace(/\D/g, '').slice(-4) } }] : []),
                  { email: { contains: q, mode: 'insensitive' as const } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const ids = leads.map((l) => l.id);
  const [names, unread, tasks] = await Promise.all([
    userNames(leads.map((l) => l.assignedToId)),
    ids.length
      ? prisma.marketingMessage.groupBy({ by: ['leadId'], where: { organizationId, leadId: { in: ids }, direction: 'inbound', readAt: null }, _count: { _all: true } })
      : Promise.resolve([]),
    ids.length
      ? prisma.marketingTask.groupBy({ by: ['leadId'], where: { organizationId, leadId: { in: ids }, status: 'open' }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  const unreadMap = new Map((unread as { leadId: string | null; _count: { _all: number } }[]).map((u) => [u.leadId, u._count._all]));
  const taskMap = new Map((tasks as { leadId: string | null; _count: { _all: number } }[]).map((u) => [u.leadId, u._count._all]));
  return {
    leads: leads.map((l) =>
      toLeadDTO(l, { assignee: l.assignedToId ? names.get(l.assignedToId) : null, unread: unreadMap.get(l.id) ?? 0, openTasks: taskMap.get(l.id) ?? 0, target: settings.speedToLeadMinutes, now }),
    ),
    speedTargetMinutes: settings.speedToLeadMinutes,
    stages: LEAD_STAGES,
  };
}

export async function getLeadDetail(organizationId: string, id: string, actor?: Actor) {
  const lead = await prisma.marketingLead.findFirst({ where: { id, organizationId } });
  if (!lead) return null;
  const settings = await getMarketingSettings(organizationId);
  const [activities, messages, tasks, names] = await Promise.all([
    prisma.marketingLeadActivity.findMany({ where: { leadId: id, organizationId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.marketingMessage.findMany({ where: { leadId: id, organizationId }, orderBy: { createdAt: 'asc' }, take: 200 }),
    prisma.marketingTask.findMany({ where: { leadId: id, organizationId }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 50 }),
    userNames([lead.assignedToId]),
  ]);
  if (actor) {
    await writeAuditLog({ action: 'MARKETING_LEAD_VIEW', actorUserId: actor.userId, actorRole: actor.role, organizationId, resourceType: 'marketing_lead', resourceId: id }).catch(() => {});
  }
  const now = new Date();
  return {
    lead: toLeadDTO(lead, { assignee: lead.assignedToId ? names.get(lead.assignedToId) : null, target: settings.speedToLeadMinutes, now }),
    activities: activities.map((a) => ({ id: a.id, kind: a.kind, summary: a.summary, actorName: a.actorName, createdAt: a.createdAt.toISOString() })),
    messages: messages.map((m) => ({
      id: m.id,
      channel: m.channel,
      direction: m.direction,
      subject: m.subject,
      body: m.body,
      status: m.status,
      reason: m.reason,
      createdAt: m.createdAt.toISOString(),
      readAt: iso(m.readAt),
    })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, dueAt: iso(t.dueAt), status: t.status, source: t.source, assignedToId: t.assignedToId })),
  };
}

export async function addActivity(organizationId: string, leadId: string, kind: string, summary: string, actor?: Actor | null) {
  await prisma.marketingLeadActivity.create({
    data: { organizationId, leadId, kind, summary: summary.slice(0, 500), actorId: actor?.userId ?? null, actorName: actor?.name ?? null },
  });
}

/** Possible existing client for a lead (flag + matched fields only). */
export async function findClientMatch(organizationId: string, p: { firstName: string; lastName: string; dateOfBirth?: string | null; phone?: string | null }): Promise<DedupeMatch | null> {
  const last4 = phoneKey(p.phone).slice(-4);
  const or: object[] = [{ name: { contains: p.lastName.trim(), mode: 'insensitive' } }];
  if (last4) or.push({ phone: { contains: last4 } });
  const candidates = await prisma.client.findMany({
    where: { organizationId, OR: or as never },
    select: { name: true, phone: true, dateOfBirth: true },
    take: 300,
  });
  return bestMatch({ firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth ?? null, phone: p.phone ?? null }, candidates);
}

/** Open lead that looks like the same person (staff can merge by hand). */
export async function findDuplicateLead(organizationId: string, p: { firstName: string; lastName: string; dateOfBirth?: string | null; phone?: string | null; email?: string | null }, excludeId?: string) {
  const last4 = phoneKey(p.phone).slice(-4);
  const rows = await prisma.marketingLead.findMany({
    where: {
      organizationId,
      stage: { in: OPEN_STAGES },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ lastName: { equals: p.lastName.trim(), mode: 'insensitive' } }, ...(last4 ? [{ phone: { contains: last4 } }] : []), ...(p.email ? [{ email: { equals: p.email, mode: 'insensitive' as const } }] : [])],
    },
    select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true, email: true },
    take: 50,
  });
  for (const r of rows) {
    if (p.email && r.email && r.email.toLowerCase() === p.email.toLowerCase()) return { id: r.id, basis: 'email' };
    const m = bestMatch(p, [r]);
    if (m?.level === 'strong') return { id: r.id, basis: m.basis };
  }
  return null;
}

export type CreateLeadInput = {
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  source: string;
  sourceDetail?: string | null;
  partnerId?: string | null;
  eventId?: string | null;
  formId?: string | null;
  serviceInterest?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  insurance?: string | null;
  preferredContact?: string | null;
  contactConsent?: boolean;
  smsConsent?: boolean;
  smsConsentSource?: string | null;
  emailConsent?: boolean;
  notes?: string | null;
  assignedToId?: string | null;
  campaignTag?: string | null;
};

export async function createLead(organizationId: string, input: CreateLeadInput, actor: Actor | null) {
  const notesIssues = clinicalTermsIn(input.notes);
  if (notesIssues.length) {
    return { ok: false as const, status: 400, error: 'Keep clinical details out of lead notes (minimum necessary). Record them in the intake assessment after conversion. If the person is in crisis, follow the crisis protocol and share 988.' };
  }
  const phone = input.phone ? toUsE164(input.phone) ?? input.phone.trim() : null;
  const match = await findClientMatch(organizationId, { firstName: input.firstName, lastName: input.lastName, dateOfBirth: input.dateOfBirth, phone });
  const dup = await findDuplicateLead(organizationId, { ...input, phone });
  const now = new Date();
  const lead = await prisma.marketingLead.create({
    data: {
      organizationId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone,
      email: input.email?.trim().toLowerCase() || null,
      dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null,
      source: input.source,
      sourceDetail: input.sourceDetail ?? null,
      partnerId: input.partnerId ?? null,
      eventId: input.eventId ?? null,
      formId: input.formId ?? null,
      serviceInterest: input.serviceInterest ?? null,
      locationId: input.locationId ?? null,
      locationName: input.locationName ?? null,
      insurance: input.insurance ?? null,
      preferredContact: input.preferredContact ?? null,
      contactConsent: Boolean(input.contactConsent),
      smsConsent: Boolean(input.smsConsent),
      smsConsentAt: input.smsConsent ? now : null,
      smsConsentSource: input.smsConsent ? input.smsConsentSource ?? (actor ? 'staff_recorded' : 'web_form') : null,
      emailConsent: Boolean(input.emailConsent),
      notes: input.notes?.trim() || null,
      assignedToId: input.assignedToId ?? null,
      possibleClientMatch: Boolean(match),
      campaignTag: input.campaignTag ?? null,
      createdById: actor?.userId ?? null,
    },
  });
  await addActivity(organizationId, lead.id, 'system', `Lead created (${leadSourceLabel(input.source)}${input.sourceDetail ? `: ${input.sourceDetail}` : ''}).`, actor);
  if (match) await addActivity(organizationId, lead.id, 'system', `Possible existing client (matched on ${match.basis}). Check the client list before converting.`, null);
  if (dup) await addActivity(organizationId, lead.id, 'system', `Possible duplicate of another open lead (matched on ${dup.basis}).`, null);
  await writeAuditLog({ action: 'MARKETING_LEAD_CREATE', actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? 'PUBLIC', organizationId, resourceType: 'marketing_lead', resourceId: lead.id, metadata: { source: input.source, possibleClientMatch: Boolean(match) } }).catch(() => {});
  await fireTrigger(organizationId, { type: 'lead_created', leadId: lead.id, source: lead.source }).catch((e) => console.error('[marketing] trigger lead_created', e instanceof Error ? e.message : e));
  return { ok: true as const, lead, possibleClientMatch: match, duplicateLead: dup };
}

export type UpdateLeadInput = Partial<Omit<CreateLeadInput, 'source'>> & {
  source?: string;
  stage?: string;
  lostReason?: string | null;
  intakeScheduledAt?: string | null;
};

export async function updateLead(organizationId: string, id: string, patch: UpdateLeadInput, actor: Actor | null, opts: { fromAutomation?: boolean } = {}) {
  const lead = await prisma.marketingLead.findFirst({ where: { id, organizationId } });
  if (!lead) return { ok: false as const, status: 404, error: 'Lead not found.' };
  if (lead.stage === 'converted' && Object.keys(patch).some((k) => k !== 'notes')) {
    return { ok: false as const, status: 409, error: 'This lead is already a client. Work with them from the client chart.' };
  }
  if (patch.notes !== undefined && clinicalTermsIn(patch.notes).length) {
    return { ok: false as const, status: 400, error: 'Keep clinical details out of lead notes (minimum necessary). Record them in the intake assessment after conversion.' };
  }
  const data: Record<string, unknown> = {};
  const now = new Date();
  const simple = ['firstName', 'lastName', 'email', 'source', 'sourceDetail', 'partnerId', 'eventId', 'serviceInterest', 'locationId', 'locationName', 'insurance', 'preferredContact', 'notes', 'campaignTag'] as const;
  for (const k of simple) if (patch[k] !== undefined) data[k] = typeof patch[k] === 'string' ? (patch[k] as string).trim() || null : patch[k];
  if (patch.firstName !== undefined && !patch.firstName?.trim()) return { ok: false as const, status: 400, error: 'First name is required.' };
  if (patch.lastName !== undefined && !patch.lastName?.trim()) return { ok: false as const, status: 400, error: 'Last name is required.' };
  if (patch.phone !== undefined) data.phone = patch.phone ? toUsE164(patch.phone) ?? patch.phone.trim() : null;
  if (patch.dateOfBirth !== undefined) data.dateOfBirth = patch.dateOfBirth ? new Date(`${patch.dateOfBirth}T00:00:00Z`) : null;
  if (patch.intakeScheduledAt !== undefined) data.intakeScheduledAt = patch.intakeScheduledAt ? new Date(patch.intakeScheduledAt) : null;
  if (patch.contactConsent !== undefined) data.contactConsent = Boolean(patch.contactConsent);
  if (patch.emailConsent !== undefined) data.emailConsent = Boolean(patch.emailConsent);
  if (patch.smsConsent !== undefined) {
    if (patch.smsConsent && lead.smsOptOutAt) return { ok: false as const, status: 409, error: 'This number replied STOP. Only the person can opt back in (reply START).' };
    data.smsConsent = Boolean(patch.smsConsent);
    data.smsConsentAt = patch.smsConsent ? now : null;
    data.smsConsentSource = patch.smsConsent ? patch.smsConsentSource ?? 'staff_recorded_verbal' : null;
  }
  let assignedChange: string | null | undefined;
  if (patch.assignedToId !== undefined) {
    if (patch.assignedToId) {
      const u = await prisma.user.findFirst({ where: { id: patch.assignedToId, organizationId, status: 'ACTIVE' }, select: { id: true } });
      if (!u) return { ok: false as const, status: 400, error: 'Staff member not found.' };
    }
    data.assignedToId = patch.assignedToId || null;
    assignedChange = patch.assignedToId || null;
  }
  let stageChange: string | null = null;
  if (patch.stage !== undefined && patch.stage !== lead.stage) {
    const mv = canMoveStage(lead.stage, patch.stage, { reason: patch.lostReason });
    if (mv.ok === false) return { ok: false as const, status: 400, error: mv.error };
    data.stage = patch.stage;
    data.stageChangedAt = now;
    data.furthestStage = nextFurthestStage(lead.furthestStage, patch.stage);
    data.lostReason = patch.stage === 'lost' || patch.stage === 'not_a_fit' ? patch.lostReason?.trim() ?? null : null;
    stageChange = patch.stage;
  }
  const updated = await prisma.marketingLead.update({ where: { id }, data });
  if (stageChange) {
    await addActivity(organizationId, id, 'stage', `Stage: ${leadStageLabel(lead.stage)} to ${leadStageLabel(stageChange)}${data.lostReason ? ` (${data.lostReason})` : ''}${opts.fromAutomation ? ' (automation)' : ''}.`, actor);
  }
  if (assignedChange !== undefined) {
    const n = assignedChange ? (await userNames([assignedChange])).get(assignedChange) : null;
    await addActivity(organizationId, id, 'assign', assignedChange ? `Assigned to ${n ?? 'staff'}.` : 'Unassigned.', actor);
  }
  if (patch.notes !== undefined) await addActivity(organizationId, id, 'note', 'Notes updated.', actor);
  if (patch.smsConsent !== undefined) await addActivity(organizationId, id, 'system', patch.smsConsent ? 'SMS consent recorded by staff.' : 'SMS consent removed.', actor);
  await writeAuditLog({ action: 'MARKETING_LEAD_UPDATE', actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? (opts.fromAutomation ? 'SYSTEM' : null), organizationId, resourceType: 'marketing_lead', resourceId: id, metadata: { fields: Object.keys(data), stage: stageChange } }).catch(() => {});
  if (stageChange && !opts.fromAutomation) {
    await fireTrigger(organizationId, { type: 'stage_changed', leadId: id, toStage: stageChange }).catch((e) => console.error('[marketing] trigger stage_changed', e instanceof Error ? e.message : e));
  }
  return { ok: true as const, lead: updated };
}

export async function markIntakeNoShow(organizationId: string, id: string, actor: Actor) {
  const lead = await prisma.marketingLead.findFirst({ where: { id, organizationId } });
  if (!lead) return { ok: false as const, status: 404, error: 'Lead not found.' };
  if (lead.stage !== 'scheduled') return { ok: false as const, status: 400, error: 'Only a lead in Scheduled can be marked as a missed intake.' };
  await prisma.marketingLead.update({ where: { id }, data: { intakeNoShowAt: new Date() } });
  await addActivity(organizationId, id, 'system', 'Marked as missed intake.', actor);
  await fireTrigger(organizationId, { type: 'intake_no_show', leadId: id }).catch(() => {});
  return { ok: true as const };
}

/** A phone call to the lead (counts as first response for speed to lead). */
export async function logCall(organizationId: string, id: string, outcome: string, actor: Actor) {
  const lead = await prisma.marketingLead.findFirst({ where: { id, organizationId } });
  if (!lead) return { ok: false as const, status: 404, error: 'Lead not found.' };
  const now = new Date();
  await prisma.marketingLead.update({ where: { id }, data: { firstResponseAt: lead.firstResponseAt ?? now, lastContactAt: now, ...(outcome === 'reached' && lead.stage === 'new' ? { stage: 'contacted', stageChangedAt: now, furthestStage: nextFurthestStage(lead.furthestStage, 'contacted') } : {}) } });
  const label: Record<string, string> = { reached: 'Called: reached', voicemail: 'Called: left voicemail', no_answer: 'Called: no answer', wrong_number: 'Called: wrong number' };
  await addActivity(organizationId, id, 'call', label[outcome] ?? 'Called', actor);
  return { ok: true as const };
}

export async function sendLeadMessage(
  organizationId: string,
  id: string,
  input: { channel: 'sms' | 'email'; body: string; subject?: string | null; templateId?: string | null },
  actor: Actor | null,
  opts: { runId?: string | null; purpose?: 'lead_follow_up' | 'inquiry_reply' } = {},
): Promise<{ ok: true; result: MarketingSendResult } | { ok: false; status: number; error: string }> {
  const lead = await prisma.marketingLead.findFirst({ where: { id, organizationId } });
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };
  const body = input.body.trim();
  if (!body) return { ok: false, status: 400, error: 'Write a message.' };
  const result = await sendMarketingMessage({
    organizationId,
    channel: input.channel,
    purpose: opts.purpose ?? 'lead_follow_up',
    recipient: { ...lead, isClient: lead.stage === 'converted' },
    body,
    subject: input.subject,
    leadId: id,
    runId: opts.runId ?? null,
    templateId: input.templateId ?? null,
    actorId: actor?.userId ?? null,
    actorRole: actor?.role ?? null,
  });
  const now = new Date();
  if (result.status === 'sent') {
    await prisma.marketingLead.update({ where: { id }, data: { firstResponseAt: lead.firstResponseAt ?? now, lastContactAt: now } });
  }
  await addActivity(
    organizationId,
    id,
    'message',
    `${input.channel === 'sms' ? 'Text' : 'Email'} ${result.status === 'sent' ? 'sent' : result.status === 'queued' ? `queued (${result.reason.replace(/_/g, ' ')})` : `not sent (${String(result.reason).replace(/_/g, ' ')})`}${opts.runId ? ' by automation' : ''}.`,
    actor,
  );
  return { ok: true, result };
}

export async function addLeadTask(organizationId: string, leadId: string | null, input: { title: string; dueAt?: string | Date | null; assignedToId?: string | null; source?: string }, actor: Actor | null) {
  const task = await prisma.marketingTask.create({
    data: {
      organizationId,
      leadId,
      title: input.title.trim().slice(0, 200),
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      assignedToId: input.assignedToId ?? null,
      source: input.source ?? 'manual',
      createdById: actor?.userId ?? null,
    },
  });
  if (leadId) await addActivity(organizationId, leadId, 'task', `Task: ${task.title}`, actor);
  return task;
}

export async function completeTask(organizationId: string, taskId: string, done: boolean, actor: Actor) {
  const t = await prisma.marketingTask.findFirst({ where: { id: taskId, organizationId } });
  if (!t) return { ok: false as const, status: 404, error: 'Task not found.' };
  await prisma.marketingTask.update({ where: { id: taskId }, data: { status: done ? 'done' : 'open', completedAt: done ? new Date() : null } });
  if (t.leadId && done) await addActivity(organizationId, t.leadId, 'task', `Done: ${t.title}`, actor);
  return { ok: true as const };
}

export async function listOpenTasks(organizationId: string, assignedToId?: string) {
  const tasks = await prisma.marketingTask.findMany({
    where: { organizationId, status: 'open', ...(assignedToId ? { assignedToId } : {}) },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  });
  const leadIds = Array.from(new Set(tasks.map((t) => t.leadId).filter((x): x is string => Boolean(x))));
  const leads = leadIds.length ? await prisma.marketingLead.findMany({ where: { id: { in: leadIds }, organizationId }, select: { id: true, firstName: true, lastName: true } }) : [];
  const lm = new Map(leads.map((l) => [l.id, `${l.firstName} ${l.lastName}`]));
  return tasks.map((t) => ({ id: t.id, title: t.title, dueAt: iso(t.dueAt), leadId: t.leadId, leadName: t.leadId ? lm.get(t.leadId) ?? null : null, source: t.source, assignedToId: t.assignedToId }));
}

export async function listAssignees(organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId, status: 'ACTIVE', role: { in: ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'FRONT_DESK'] as Role[] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
    take: 200,
  });
  return users.map((u) => ({ id: u.id, name: u.name || u.email || 'Staff', role: u.role }));
}

/** Conversations inbox: leads with messages, newest activity first. */
export async function listConversations(organizationId: string) {
  const recent = await prisma.marketingMessage.findMany({
    where: { organizationId, leadId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 600,
    select: { leadId: true, body: true, direction: true, channel: true, createdAt: true, readAt: true, status: true },
  });
  const byLead = new Map<string, { last: (typeof recent)[number]; unread: number }>();
  for (const m of recent) {
    const k = m.leadId!;
    const cur = byLead.get(k);
    if (!cur) byLead.set(k, { last: m, unread: m.direction === 'inbound' && !m.readAt ? 1 : 0 });
    else if (m.direction === 'inbound' && !m.readAt) cur.unread += 1;
  }
  const ids = Array.from(byLead.keys()).slice(0, 150);
  const leads = ids.length ? await prisma.marketingLead.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, firstName: true, lastName: true, stage: true, smsOptOutAt: true } }) : [];
  return leads
    .map((l) => {
      const c = byLead.get(l.id)!;
      return {
        leadId: l.id,
        name: `${l.firstName} ${l.lastName}`,
        stage: l.stage,
        stageLabel: leadStageLabel(l.stage),
        optedOut: Boolean(l.smsOptOutAt),
        lastMessage: c.last.body.slice(0, 140),
        lastDirection: c.last.direction,
        lastChannel: c.last.channel,
        lastStatus: c.last.status,
        lastAt: c.last.createdAt.toISOString(),
        unread: c.unread,
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export async function markConversationRead(organizationId: string, leadId: string) {
  await prisma.marketingMessage.updateMany({ where: { organizationId, leadId, direction: 'inbound', readAt: null }, data: { readAt: new Date() } });
}

export type ConvertInput = {
  date: string;
  startTime: string;
  clinicianId: string;
  appointmentType?: string;
  isVirtual?: boolean;
  locationId?: string | null;
  confirmNewPerson?: boolean;
};

/**
 * One click: create the client (existing createClient, same rules as the client intake form) and
 * the intake appointment (existing createAppointment), then close the lead as converted and stop
 * its automations. A possible existing client blocks until staff confirm it is a new person.
 */
export async function convertLead(organizationId: string, id: string, input: ConvertInput, actor: Actor) {
  const lead = await prisma.marketingLead.findFirst({ where: { id, organizationId } });
  if (!lead) return { ok: false as const, status: 404, error: 'Lead not found.' };
  const mv = canMoveStage(lead.stage, 'converted', { viaConvert: true });
  if (mv.ok === false) return { ok: false as const, status: 400, error: mv.error };
  const match = await findClientMatch(organizationId, { firstName: lead.firstName, lastName: lead.lastName, dateOfBirth: lead.dateOfBirth?.toISOString().slice(0, 10) ?? null, phone: lead.phone });
  if (match && !input.confirmNewPerson) {
    return {
      ok: false as const,
      status: 409,
      error: `Possible existing client (matched on ${match.basis}). Search the client list first. If this is a new person, confirm and convert again.`,
      possibleClientMatch: match,
    };
  }
  const created = await createClient(
    {
      name: `${lead.firstName} ${lead.lastName}`.trim(),
      legalFirstName: lead.firstName,
      legalLastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      dateOfBirth: lead.dateOfBirth ? lead.dateOfBirth.toISOString().slice(0, 10) : null,
      insurancePayer: lead.insurance,
      locationId: input.locationId ?? lead.locationId ?? null,
      assignedToId: input.clinicianId,
      status: 'ACTIVE',
    },
    actor.userId,
    organizationId,
    actor.role as Role,
  );
  if (!created.ok) return { ok: false as const, status: created.status, error: created.error };
  const clientId = created.client.id;
  // Carry SMS consent only as recorded on the lead, with its source (TCPA: consent is per number)
  if (lead.smsConsent && !lead.smsOptOutAt && lead.phone) {
    await prisma.client
      .update({ where: { id: clientId }, data: { smsConsent: true, smsConsentAt: lead.smsConsentAt ?? new Date(), smsConsentSource: `lead:${lead.smsConsentSource ?? 'recorded'}` } })
      .catch(() => {});
  }
  const appt = await createAppointment(
    {
      clientId,
      type: input.appointmentType?.trim() || 'Initial Assessment',
      date: input.date,
      startTime: input.startTime,
      isVirtual: Boolean(input.isVirtual),
      clinicianId: input.clinicianId,
      notes: null,
    },
    actor.userId,
    organizationId,
    actor.role as Role,
  );
  const now = new Date();
  await prisma.marketingLead.update({
    where: { id },
    data: {
      stage: 'converted',
      furthestStage: 'converted',
      stageChangedAt: now,
      convertedAt: now,
      convertedClientId: clientId,
      intakeAppointmentId: appt.ok ? appt.appointment.id : null,
      firstResponseAt: lead.firstResponseAt ?? now,
    },
  });
  await prisma.marketingWorkflowRun.updateMany({ where: { organizationId, leadId: id, status: { in: ['active', 'waiting'] } }, data: { status: 'stopped', finishedAt: now, waitUntil: null } });
  await addActivity(organizationId, id, 'convert', appt.ok ? 'Converted to client; intake appointment booked. Automations stopped.' : `Converted to client. Intake appointment not booked: ${appt.error}`, actor);
  await writeAuditLog({ action: 'MARKETING_LEAD_CONVERT', actorUserId: actor.userId, actorRole: actor.role, organizationId, resourceType: 'patient', resourceId: clientId, patientId: clientId, metadata: { leadId: id, appointmentBooked: appt.ok } }).catch(() => {});
  return { ok: true as const, clientId, appointmentId: appt.ok ? appt.appointment.id : null, appointmentError: appt.ok ? null : appt.error };
}
