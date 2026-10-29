import 'server-only';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { listRiskAlerts } from '@/lib/alerts/manage';
import { listMbcAlerts } from '@/lib/clinical/mbcAlerts';
import { loadMeasureInbox } from '@/lib/measures/staffViews';
import { loadSessionFrequency } from '@/lib/clinical/sessionFrequencyData';
import { redactLockedItem } from '@/lib/clinical/sessionFrequency';
import { listMessageThreads } from '@/lib/messages/manage';
import { listCosignQueue } from '@/lib/notes/workflow-store';
import { listStaffTasks } from '@/lib/tasks/manage';
import { docIntakeOrgWhere, DOC_INTAKE_NEEDS_REVIEW } from '@/lib/docIntake/queue';
import { canPrescribe } from '@/types/roles';
import { practiceNoteSignDeadlineHours } from '@/lib/practice/consumers';
import { listPlanPendingClients, listPlanReviewReminders } from '@/lib/ehr/therapy/planStore';
import { clinicDate } from '@/lib/workflows/dates';
import { loadClientStatusRows } from '@/lib/consents/carelon/store';
import { loadComplianceRows } from '@/lib/consents/library/store';
import { consentInboxDrafts } from './core';
import {
  carelonInboxDrafts,
  authAttention,
  authPriority,
  isThreadAwaiting,
  planPendingInboxDraft,
  planReviewInboxDraft,
  taskEntityKey,
  truncate,
  unsignedNoteCutoff,
  type InboxActor,
  type InboxDeps,
} from './core';
import type { InboxDraft, InboxPriority } from './types';
import { labResultInboxDrafts } from '@/lib/labs/workflow';
import { loadAuthForecasts } from '@/lib/ai/authForecast/data';
import { forecastInboxItem, type AuthForecast } from '@/lib/ai/authForecast/forecast';
import { loadTimelyFilingQueue } from '@/lib/billing/timelyFilingQueue';
import { rankWaitlist } from '@/lib/scheduling/waitlistSuggest';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { formatPracticeDateTime } from '@/lib/time/practiceTime';
import { groupNoteHrefs, groupNotesInboxDrafts } from '@/lib/groups/inbox';
import { VALANT_DOC_SOURCE } from '@/lib/migration/valantDocuments';
import { filesForEveryone, myPatientsDefault, ownCaseloadClientWhere, placeInboxDocument } from '@/lib/worklists/ownership';

/**
 * One loader per inbox section. Wherever a source page already has a loader, this calls that
 * same function so the inbox count matches the page.
 */

type Loaded = { drafts: InboxDraft[]; notice?: string | null };

const scope = (a: InboxActor) => ({ organizationId: a.organizationId, actorUserId: a.userId, actorRole: a.role as Role });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const chart = (clientId: string, tab?: string) =>
  `/dashboard/clients/${encodeURIComponent(clientId)}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`;

const TOPIC_LABEL: Record<string, string> = {
  scheduling: 'Scheduling',
  billing: 'Billing',
  general: 'General',
  clinical: 'Clinical',
  'rx-refill': 'Rx refill',
};

const ALERT_TYPE_LABEL: Record<string, string> = {
  crisis_keywords: 'Crisis keywords',
  low_mood: 'Low mood',
  high_stress: 'High stress',
  SUD_REFERRAL_PROMPT: 'SUD referral review',
  risk_language: 'Risk language watch',
};

// ─── My To-Do (GET /api/tasks → listStaffTasks) ─────────────────────────────────

/** taskId of an accepted AI Scribe follow-up (src/lib/tasks/manage.ts) */
const FOLLOW_UP_TASK_PREFIX = 'scribe-follow-up-';

async function loadTasks(a: InboxActor): Promise<Loaded> {
  const all = await listStaffTasks(scope(a));
  // Clinical roles: only their own patients' tasks / tasks assigned to them (the To-Do page has the
  // "My patients only" toggle for the rest); leadership and the front office see the whole list
  const tasks = myPatientsDefault(a.role) ? all.filter((t) => t.mine !== false) : all;
  return {
    drafts: tasks.map((t) => ({
      entityKey: taskEntityKey(t.taskId),
      title: t.title,
      detail: truncate(t.description),
      clientId: t.clientId ?? null,
      clientName: t.clientName ?? null,
      priority: t.priority,
      // Tasks carry no "pending since" time
      since: null,
      href: t.actionHref,
      hrefLabel: t.actionLabel,
      // Accepted AI Scribe follow-ups can be marked done here; other To-Dos clear when the work is done
      action: t.taskId.startsWith(FOLLOW_UP_TASK_PREFIX) ? { kind: 'complete_follow_up' as const, followUpId: t.taskId.slice(FOLLOW_UP_TASK_PREFIX.length) } : null,
    })),
  };
}

// ─── Messages (GET /api/messages/threads → listMessageThreads) ─────────────────

async function loadMessages(a: InboxActor): Promise<Loaded> {
  const threads = await listMessageThreads(scope(a));
  return {
    drafts: threads.filter(isThreadAwaiting).map((t) => ({
      entityKey: `thread:${t.id}`,
      title: `${TOPIC_LABEL[t.topic] ?? 'General'} message · ${
        t.unreadCount > 0 ? `${t.unreadCount} unread` : 'waiting for reply'
      }`,
      detail: truncate(t.lastMessage, 140),
      clientId: t.clientId,
      clientName: t.clientName,
      priority: (t.risk === 'high' ? 'urgent' : t.risk === 'medium' ? 'high' : 'normal') as InboxPriority,
      since: t.lastMessageAt,
      href: `/dashboard/messages?thread=${encodeURIComponent(t.id)}`,
      hrefLabel: 'Open thread',
      action: null,
    })),
  };
}

// ─── Risk alerts (listRiskAlerts) + MBC alerts (listMbcAlerts) ─────────────────

async function loadAlerts(a: InboxActor): Promise<Loaded> {
  const drafts: InboxDraft[] = [];
  const [risk, mbc] = await Promise.all([
    canAccessPath(a.role, '/dashboard/alerts') ? listRiskAlerts({ ...scope(a), unreviewed: true }) : Promise.resolve([]),
    canAccessPath(a.role, '/dashboard/mbc')
      ? listMbcAlerts({ organizationId: a.organizationId, clientWhere: clientAccessWhere(scope(a)), unacknowledgedOnly: true }).then((r) => r.alerts)
      : Promise.resolve([]),
  ]);
  for (const r of risk) {
    const sev = r.severity === 'high' ? 'High' : r.severity === 'medium' ? 'Medium' : 'Low';
    drafts.push({
      entityKey: `riskAlert:${r.id}`,
      title: `${sev} risk alert · ${ALERT_TYPE_LABEL[r.type] ?? r.type}`,
      detail: truncate(r.description),
      clientId: r.clientId,
      clientName: r.clientName,
      priority: r.severity === 'high' ? 'urgent' : r.severity === 'medium' ? 'high' : 'normal',
      since: r.createdAt,
      href: '/dashboard/alerts?tab=risk',
      hrefLabel: 'Open alerts',
      action: { kind: 'review_risk_alert', alertId: r.id, noteRequired: r.severity === 'high' },
    });
  }
  for (const m of mbc) {
    if (m.isAcknowledged) continue;
    drafts.push({
      entityKey: `mbc:${m.id}`,
      title: `MBC escalation · ${m.instrumentName} ${m.totalScore} (${m.severity})${m.safetyFlagged ? ' · safety item' : ''}`,
      detail: truncate(m.safetyNotes),
      clientId: m.clientId,
      clientName: m.clientName,
      priority: m.safetyFlagged ? 'urgent' : 'high',
      since: m.completedAt,
      href: '/dashboard/alerts?tab=mbc',
      hrefLabel: 'Open MBC alerts',
      action: { kind: 'ack_mbc_alert', assessmentRecordId: m.assessmentRecordId },
    });
  }
  return { drafts };
}

// ─── Measures completed / Worsening (src/lib/measures/staffViews.ts) ─────────────

async function loadMeasures(a: InboxActor, now: Date): Promise<Loaded> {
  const items = await loadMeasureInbox(a, clientAccessWhere(scope(a)), now);
  return {
    drafts: items.map((m) => ({
      entityKey: m.kind === 'worsening' ? `measureWorsening:${m.recordId}` : `measureRequest:${m.requestId}`,
      title: m.title,
      detail: truncate(m.detail),
      clientId: m.clientId,
      clientName: m.clientName,
      priority: (m.safetyFlagged ? 'urgent' : m.kind === 'worsening' ? 'high' : 'normal') as InboxPriority,
      since: m.at,
      href: chart(m.clientId, 'assessments'),
      hrefLabel: 'Open measures',
      action: null,
    })),
  };
}

// ─── Session frequency (GET /api/clinical/session-frequency → loadSessionFrequency) ──

async function loadSessionOverdue(a: InboxActor, now: Date): Promise<Loaded> {
  const { items } = await loadSessionFrequency(scope(a), {}, now);
  // No contact in 180 days and nothing booked: a collapsed "likely inactive" group (not counted),
  // never an urgent overdue row
  const inactive: InboxDraft[] = items
    .filter((i) => i.bucket === 'likely_inactive')
    .map(redactLockedItem)
    .map((i) => ({
      entityKey: `sessionFrequency:${i.clientId}`,
      title: i.therapy.lastAttended ? `No session since ${i.therapy.lastAttended} — likely inactive` : 'No session on record — likely inactive',
      detail: truncate(`No appointment or note in 180 days; nothing booked${i.assignedToName ? ` · ${i.assignedToName}` : ''}. Review for discharge.`),
      clientId: i.clientId,
      clientName: i.clientName,
      priority: 'low' as InboxPriority,
      since: null,
      href: '/dashboard/alerts?tab=frequency',
      hrefLabel: 'Discharge review',
      action: null,
      group: 'likely_inactive' as const,
    }));
  return {
    drafts: [...items
      .filter((i) => i.bucket === 'overdue')
      .map(redactLockedItem)
      .map((i) => ({
        entityKey: `sessionFrequency:${i.clientId}`,
        title: `Therapy overdue by ${i.therapy.daysOverdue} day${i.therapy.daysOverdue === 1 ? '' : 's'}`,
        detail: truncate(
          `${i.therapy.recommendation.label} · last attended ${i.therapy.lastAttended ?? 'none on file'}${
            i.assignedToName ? ` · ${i.assignedToName}` : ''
          }`
        ),
        clientId: i.clientId,
        clientName: i.clientName,
        priority: (i.riskLevel === 'HIGH' ? 'urgent' : 'high') as InboxPriority,
        since: i.therapy.overdueAfter ? `${i.therapy.overdueAfter}T12:00:00.000Z` : null,
        href: chart(i.clientId, 'Appointments'),
        hrefLabel: 'Open chart',
        action: null,
      })), ...inactive],
  };
}

// ─── Refill / RxChange requests from the DrFirst sync ──────────────────────────

async function loadRxRequests(a: InboxActor): Promise<Loaded> {
  if (!canPrescribe(a.role)) return { drafts: [] };
  const me = await prisma.user.findUnique({ where: { id: a.userId }, select: { rcopiaUsername: true } });
  const username = me?.rcopiaUsername?.trim() || null;
  const [refills, changes] = await Promise.all([
    username
      ? prisma.rcopiaRefillNotification.findMany({
          // Routed by the provider who owns the renewal in Rcopia
          where: {
            actionTaken: 'pending',
            providerUsername: { equals: username, mode: 'insensitive' },
            client: clientOrgFilter(a.organizationId),
          },
          select: { id: true, clientId: true, drugPrescribed: true, pharmacyName: true, createdAt: true, client: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
    prisma.rcopiaRxchangeRequest.findMany({
      // RxChange rows carry no prescriber, so they are routed by caseload
      where: { status: 'pending', client: clientAccessWhere(scope(a)) },
      select: {
        id: true,
        clientId: true,
        orderedDrugName: true,
        requestedDrugName: true,
        requestType: true,
        changeReason: true,
        createdAt: true,
        client: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const drafts: InboxDraft[] = [
    ...refills.map((r) => ({
      entityKey: `rcopiaRefill:${r.id}`,
      title: `Refill request · ${r.drugPrescribed}`,
      detail: r.pharmacyName ? `Pharmacy: ${r.pharmacyName}` : null,
      clientId: r.clientId,
      clientName: r.client.name,
      priority: 'high' as const,
      since: iso(r.createdAt),
      href: chart(r.clientId, 'Medications'),
      hrefLabel: 'Open medications',
      action: null,
    })),
    ...changes.map((c) => ({
      entityKey: `rcopiaRxchange:${c.id}`,
      title: `RxChange · ${c.orderedDrugName} to ${c.requestedDrugName}`,
      detail: truncate([c.requestType, c.changeReason].filter(Boolean).join(' · ')),
      clientId: c.clientId,
      clientName: c.client.name,
      priority: 'high' as const,
      since: iso(c.createdAt),
      href: chart(c.clientId, 'Medications'),
      hrefLabel: 'Open medications',
      action: null,
    })),
  ];
  return {
    drafts,
    notice: username
      ? null
      : 'Your DrFirst username is not on your staff profile, so refill requests routed to you cannot be matched. RxChange requests for your caseload are still shown.',
  };
}

// ─── Co-sign queue (GET /api/ehr/supervisor-review → listCosignQueue) ──────────

async function loadCosign(a: InboxActor): Promise<Loaded> {
  const notes = await listCosignQueue({
    organizationId: a.organizationId,
    actorUserId: a.userId,
    actorRole: a.role as Role,
  });
  return {
    drafts: notes.map((n) => ({
      entityKey: `note:${n.noteId}`,
      title: `Co-sign ${n.noteType || 'note'}${n.authorName ? ` by ${n.authorName}` : ''}`,
      detail: n.dateOfService ? `Date of service ${n.dateOfService.slice(0, 10)}` : null,
      clientId: n.clientId,
      clientName: n.clientName,
      priority: 'normal' as const,
      since: n.signedAt ?? n.createdAt,
      href: `/dashboard/ehr/supervisor-review?noteId=${encodeURIComponent(n.noteId)}`,
      hrefLabel: 'Review and co-sign',
      action: null,
    })),
  };
}

// ─── My unsigned notes older than the signing deadline (default 24h) ───────────

async function loadUnsignedNotes(a: InboxActor, now: Date): Promise<Loaded> {
  const deadlineHours = await practiceNoteSignDeadlineHours(a.organizationId);
  const notes = await prisma.progressNote.findMany({
    where: {
      clinicianId: a.userId,
      client: clientOrgFilter(a.organizationId),
      createdAt: { lt: unsignedNoteCutoff(now, deadlineHours) },
      // A dismissed draft (created in error / not needed) is out of every documentation queue
      dismissedAt: null,
      // No workflow row is shown as Draft everywhere in the EHR
      OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' } } }],
    },
    select: { id: true, clientId: true, noteType: true, dateOfService: true, createdAt: true, client: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  // Notes written from a group session open on the group session page
  const groupHref = await groupNoteHrefs(notes.map((n) => n.id));
  return {
    drafts: notes.map((n) => ({
      entityKey: `note:${n.id}`,
      title: `Unsigned ${n.noteType || 'progress note'}`,
      detail: `${n.dateOfService ? `Date of service ${n.dateOfService.toISOString().slice(0, 10)} · ` : ''}written ${n.createdAt.toISOString().slice(0, 10)}`,
      clientId: n.clientId,
      clientName: n.client.name,
      priority: 'urgent' as const,
      since: iso(n.createdAt),
      href: groupHref.get(n.id) ?? `/dashboard/ehr/notes?clientId=${encodeURIComponent(n.clientId)}`,
      hrefLabel: groupHref.has(n.id) ? 'Open group session' : 'Open notes',
      // Sign / dismiss in place (group notes are signed from the group session)
      action: groupHref.has(n.id) ? null : { kind: 'unsigned_note' as const, noteId: n.id },
    })),
  };
}

// ─── Group sessions ended without attendance or with unsigned attendee notes ───

async function loadGroupNotes(a: InboxActor, now: Date): Promise<Loaded> {
  const deadlineHours = await practiceNoteSignDeadlineHours(a.organizationId);
  return { drafts: await groupNotesInboxDrafts({ organizationId: a.organizationId, userId: a.userId }, now, deadlineHours) };
}

// ─── Treatment plans needed (notes signed under the go-live transition) ─────────

async function loadPlansNeeded(a: InboxActor, now: Date): Promise<Loaded> {
  const today = clinicDate(now);
  const [clients, reviews] = await Promise.all([
    listPlanPendingClients(scope(a), { authorId: a.userId }),
    // Plan reviews coming due (Valant: reminder to the plan owner 7 days before)
    listPlanReviewReminders(scope(a), { today }).catch((err: unknown) => {
      console.error('[inbox plan review reminders]', err);
      return [];
    }),
  ]);
  return { drafts: [...clients.map((c) => planPendingInboxDraft(c, today)), ...reviews.map(planReviewInboxDraft)] };
}

// ─── Documents to file (Smart Doc Intake "Needs Review") ───────────────────────

async function loadDocuments(a: InboxActor, now: Date): Promise<Loaded> {
  const fileForAll = filesForEveryone(a.role);
  const docs = await prisma.documentIntake.findMany({
    where: { AND: [docIntakeOrgWhere(a.organizationId), { status: DOC_INTAKE_NEEDS_REVIEW }] },
    select: {
      id: true,
      source: true,
      uploadedById: true,
      documentType: true,
      fileName: true,
      matchStatus: true,
      suggestedClientId: true,
      createdAt: true,
      suggestedClient: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  // Documents for a client the user cannot open (other caseloads) are never listed; "mine" is
  // the user's own caseload, not a wider read scope
  const clientIds = [...new Set(docs.map((d) => d.suggestedClientId).filter((x): x is string => Boolean(x)))];
  const [inScope, mine] = clientIds.length
    ? await Promise.all([
        prisma.client.findMany({ where: { AND: [clientAccessWhere(scope(a)), { id: { in: clientIds } }] }, select: { id: true } }),
        prisma.client.findMany({
          where: { AND: [clientAccessWhere(scope(a)), ownCaseloadClientWhere(a.role, a.userId, now), { id: { in: clientIds } }] },
          select: { id: true },
        }),
      ])
    : [[], []];
  const accessible = new Set(inScope.map((c) => c.id));
  const myClientIds = new Set(mine.map((c) => c.id));
  const placed = docs
    .filter((d) => !d.suggestedClientId || accessible.has(d.suggestedClientId))
    .map((d) => ({
      d,
      place: placeInboxDocument(
        { isValantImport: d.source === VALANT_DOC_SOURCE, suggestedClientId: d.suggestedClientId, uploadedById: d.uploadedById },
        { userId: a.userId, fileForAll, myClientIds }
      ),
    }))
    .filter((x) => x.place !== null);
  return {
    drafts: placed.map(({ d, place }) => ({
      ...(place === 'mine' ? {} : { group: place as 'all_documents' | 'valant_import' }),
      entityKey: `docIntake:${d.id}`,
      title: `${d.documentType || 'Document'} to file`,
      detail: truncate(
        [d.source, d.matchStatus === 'matched' ? 'patient matched' : d.matchStatus === 'unmatched' ? 'no patient matched' : 'match needs review']
          .filter(Boolean)
          .join(' · ')
      ),
      clientId: d.suggestedClientId,
      clientName: d.suggestedClient?.name ?? null,
      priority: (d.matchStatus === 'unmatched' ? 'high' : 'normal') as InboxPriority,
      since: iso(d.createdAt),
      href: `/dashboard/ehr/doc-intake?doc=${encodeURIComponent(d.id)}`,
      hrefLabel: 'Review and file',
      action: null,
    })),
  };
}

// ─── Authorizations expiring ───────────────────────────────────────────────────

async function loadAuthorizations(a: InboxActor, now: Date): Promise<Loaded> {
  const auths = await prisma.priorAuth.findMany({
    where: { organizationId: a.organizationId, status: 'APPROVED', client: clientAccessWhere(scope(a)) },
    select: {
      id: true,
      clientId: true,
      payer: true,
      authNumber: true,
      status: true,
      endDate: true,
      unitsApproved: true,
      unitsUsed: true,
      client: { select: { name: true } },
    },
    orderBy: { endDate: 'asc' },
  });
  // Run-out forecast (attended + scheduled visits, payer lead time); the 14-day / 3-visit rule still applies
  let forecasts: Map<string, AuthForecast> | null = null;
  let notice: string | null = null;
  try {
    forecasts = new Map((await loadAuthForecasts(scope(a), {}, now)).forecasts.map((f) => [f.priorAuthId, f]));
  } catch (err) {
    console.error('[inbox] authorization forecast failed', err instanceof Error ? err.message : 'unknown error');
    notice = 'Run-out forecast unavailable; showing end dates and visits left only';
  }
  const rank: Record<InboxPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const drafts: InboxDraft[] = [];
  for (const p of auths) {
    const att = authAttention(p, now);
    const fc = forecasts?.get(p.id);
    const fi = fc ? forecastInboxItem(fc) : null;
    if (!att && !fi) continue;
    const basePriority: InboxPriority = att ? authPriority(att) : 'low';
    drafts.push({
      entityKey: `priorAuth:${p.id}`,
      title: fi ? fi.title : `Authorization ${att!.reasons.join(', ')}`,
      detail: `${p.payer}${p.authNumber ? ` · #${p.authNumber}` : ''}`,
      clientId: p.clientId,
      clientName: p.client.name,
      priority: fi && rank[fi.priority] < rank[basePriority] ? fi.priority : basePriority,
      // Age from the end date when it has passed; otherwise no age
      since: att?.expired || fc?.status === 'expired' ? iso(p.endDate) : null,
      href: '/dashboard/billing/authorizations?tab=tracking',
      hrefLabel: 'Open authorizations',
      action: null,
    });
  }
  return { drafts, notice };
}

// ─── Claims nearing timely filing (same claims as the Claims page) ─────────────

async function loadTimelyFiling(a: InboxActor, now: Date): Promise<Loaded> {
  const rows = await loadTimelyFilingQueue(scope(a), now);
  return {
    drafts: rows.map((r) => ({
      entityKey: `claim:${r.claimId}`,
      title: r.daysLeft < 0 ? `Claim past timely filing (${-r.daysLeft} day(s) over)` : `Claim timely filing: ${r.daysLeft} day(s) left`,
      detail: `${r.payer} · DOS ${r.serviceDate} · ${r.limitDays}-day limit (verify contract)`,
      clientId: r.clientId,
      clientName: r.clientName,
      priority: (r.daysLeft < 0 ? 'urgent' : r.daysLeft <= 7 ? 'high' : 'normal') as InboxPriority,
      since: null,
      href: `/dashboard/billing/claims?claimId=${encodeURIComponent(r.claimId)}`,
      hrefLabel: 'Open claim',
      action: null,
    })),
  };
}

// ─── SUD Referral Radar (same query as GET /api/ehr/scanner/sud-radar?status=new) ──

const SUD_PRIORITY: Record<string, InboxPriority> = { urgent: 'urgent', high: 'high', routine: 'normal', low: 'low' };

async function loadSudRadar(a: InboxActor): Promise<Loaded> {
  const signals = await prisma.sudRadarSignal.findMany({
    where: { organizationId: a.organizationId, status: 'new', client: clientAccessWhere(scope(a)) },
    select: {
      id: true,
      clientId: true,
      detectedCondition: true,
      actionLabel: true,
      priority: true,
      scannedAt: true,
      client: { select: { name: true } },
    },
    orderBy: { scannedAt: 'asc' },
  });
  return {
    drafts: signals.map((s) => ({
      entityKey: `sudSignal:${s.id}`,
      title: `SUD signal · ${s.detectedCondition}`,
      detail: s.actionLabel ? `Suggested: ${s.actionLabel}` : null,
      clientId: s.clientId,
      clientName: s.client.name,
      priority: SUD_PRIORITY[s.priority ?? ''] ?? 'normal',
      since: iso(s.scannedAt),
      href: '/dashboard/ehr/scanner/sud-radar',
      hrefLabel: 'Open radar',
      action: null,
    })),
  };
}

// ─── Lab results to review (orders this provider placed; same scope as GET /api/labs/orders) ──

async function loadLabResults(a: InboxActor): Promise<Loaded> {
  const rows = await prisma.labOrder.findMany({
    where: {
      organizationId: a.organizationId,
      orderedById: a.userId,
      status: { in: ['resulted', 'critical'] },
      reviewedAt: null,
      client: clientAccessWhere(scope(a)),
    },
    select: {
      id: true,
      clientId: true,
      clientName: true,
      panels: true,
      otherPanel: true,
      hasCritical: true,
      status: true,
      resultedAt: true,
      orderedAt: true,
      results: { select: { flag: true } },
    },
    orderBy: { resultedAt: 'asc' },
    take: 200,
  });
  return {
    drafts: labResultInboxDrafts(rows.map((r) => ({ ...r, abnormalCount: r.results.filter((x) => x.flag && x.flag !== 'N').length }))).map((d, i) => ({
      ...d,
      // Acknowledge (provider sign-off) in place; critical results still open in the chart too
      action: { kind: 'ack_lab_result' as const, labOrderId: rows[i].id, critical: Boolean(rows[i].hasCritical || rows[i].status === 'critical') },
    })),
  };
}

// ─── Waitlist offers: freed future slots (cancel / late cancel in the last 7 days) ──

const WAITLIST_PRIORITY: Record<string, InboxPriority> = { CRISIS: 'urgent', URGENT: 'high', ROUTINE: 'normal' };

async function loadWaitlistOffers(a: InboxActor, now: Date): Promise<Loaded> {
  const freed = await prisma.appointment.findMany({
    where: {
      organizationId: a.organizationId,
      status: { in: ['CANCELLED', 'LATE_CANCEL'] },
      startsAt: { gt: now },
      updatedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
    },
    select: { id: true, clinicianId: true, clinicianName: true, type: true, startsAt: true, updatedAt: true },
    orderBy: { startsAt: 'asc' },
    take: 25,
  });
  if (!freed.length) return { drafts: [] };
  const entries = await prisma.waitlistEntry.findMany({
    where: { organizationId: a.organizationId, status: 'WAITING' },
    select: { id: true, name: true, urgency: true, specialty: true, clinicianId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  if (!entries.length) return { drafts: [] };
  const tz = await getPracticeTimeZone(a.organizationId);
  const drafts: InboxDraft[] = [];
  for (const slot of freed) {
    for (const s of rankWaitlist(entries, slot, 3)) {
      drafts.push({
        entityKey: `waitlist:${s.entryId}:${slot.id}`,
        title: `Waitlist match for a freed ${slot.type} time`,
        detail: `${formatPracticeDateTime(slot.startsAt, tz)}${slot.clinicianName ? ` · ${slot.clinicianName}` : ''} · ${
          s.match === 'same_clinician' ? 'asked for this clinician' : `needs ${s.specialty}`
        }. Suggestion only: contact the person and book.`,
        clientId: null,
        clientName: s.name,
        priority: WAITLIST_PRIORITY[s.urgency] ?? 'normal',
        since: iso(slot.updatedAt),
        href: '/dashboard/clients/waitlist',
        hrefLabel: 'Open waitlist',
        action: null,
      });
    }
  }
  return { drafts };
}

// ─── Online-booking identity checks (src/lib/scheduling/identity.ts) ──

const IDENTITY_REASON: Record<string, string> = {
  new_online_booking: 'New chart from online booking: confirm identity at the first visit',
  possible_duplicate_email: 'Email matches another chart: possible duplicate, verify and merge by hand',
  possible_duplicate_phone: 'Phone matches another chart: possible duplicate, verify and merge by hand',
  possible_duplicate_name_dob: 'Name and date of birth match more than one chart: verify which person this is',
  contact_mismatch: 'Booked online with an email or phone different from the chart: verify before updating contact details',
};

async function loadIdentityVerify(a: InboxActor): Promise<Loaded> {
  const rows = await prisma.client.findMany({
    where: { organizationId: a.organizationId, identityVerifyRequired: true },
    select: { id: true, name: true, identityVerifyReason: true, updatedAt: true },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  });
  return {
    drafts: rows.map((c) => ({
      entityKey: `identity:${c.id}`,
      title: 'Verify identity (online booking)',
      detail: IDENTITY_REASON[c.identityVerifyReason ?? ''] ?? 'Verify identity before the first visit',
      clientId: c.id,
      clientName: c.name,
      priority: (c.identityVerifyReason && c.identityVerifyReason !== 'new_online_booking' ? 'high' : 'normal') as InboxPriority,
      since: iso(c.updatedAt),
      href: chart(c.id),
      hrefLabel: 'Open chart',
      action: { kind: 'verify_identity', clientId: c.id, noteRequired: true },
    })),
  };
}

// ─── Medicaid attestations (Carelon non-overlap; same rows as /api/consents/carelon) ──────

const ATTESTATION_VISIT_DAYS = 7;

async function loadMedicaidAttestations(a: InboxActor, now: Date): Promise<Loaded> {
  const rows = await loadClientStatusRows(clientAccessWhere(scope(a)), a.organizationId, { now });
  const need = rows.filter((r) => r.state !== 'complete' && r.state !== 'not_required').map((r) => r.clientId);
  const upcoming = new Map<string, string>();
  if (need.length) {
    const visits = await prisma.appointment.groupBy({
      by: ['clientId'],
      where: {
        clientId: { in: need },
        startsAt: { gte: now, lt: new Date(now.getTime() + ATTESTATION_VISIT_DAYS * 86_400_000) },
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL', 'COMPLETED'] },
      },
      _min: { startsAt: true },
    });
    for (const v of visits) if (v._min.startsAt) upcoming.set(v.clientId, v._min.startsAt.toISOString());
  }
  return carelonInboxDrafts(rows, upcoming);
}

// ─── Consents to complete (consent library; same rows as the "Consent compliance" report) ──

async function loadConsentsNeeded(a: InboxActor, now: Date): Promise<Loaded> {
  const rows = await loadComplianceRows(clientAccessWhere(scope(a)), a.organizationId, { now });
  const need = [...new Set(rows.filter((r) => r.required && r.needsAction).map((r) => r.clientId))];
  const upcoming = new Map<string, string>();
  if (need.length) {
    const visits = await prisma.appointment.groupBy({
      by: ['clientId'],
      where: {
        clientId: { in: need },
        startsAt: { gte: now, lt: new Date(now.getTime() + ATTESTATION_VISIT_DAYS * 86_400_000) },
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL', 'COMPLETED'] },
      },
      _min: { startsAt: true },
    });
    for (const v of visits) if (v._min.startsAt) upcoming.set(v.clientId, v._min.startsAt.toISOString());
  }
  return consentInboxDrafts(rows, upcoming);
}

export const INBOX_LOADERS: InboxDeps['loaders'] = {
  alerts: loadAlerts,
  rx_requests: loadRxRequests,
  lab_results: loadLabResults,
  messages: loadMessages,
  unsigned_notes: loadUnsignedNotes,
  group_notes: loadGroupNotes,
  cosign: loadCosign,
  plans_needed: loadPlansNeeded,
  session_frequency: loadSessionOverdue,
  sud_radar: loadSudRadar,
  measures: loadMeasures,
  documents: loadDocuments,
  authorizations: loadAuthorizations,
  timely_filing: loadTimelyFiling,
  waitlist_offer: loadWaitlistOffers,
  identity_verify: loadIdentityVerify,
  medicaid_attestations: loadMedicaidAttestations,
  consents_needed: loadConsentsNeeded,
  tasks: loadTasks,
};
