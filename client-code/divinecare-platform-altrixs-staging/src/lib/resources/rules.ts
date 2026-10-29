/**
 * Resource library rules (pure; shared by the store, API routes, pages and tests).
 */
import { SUD_TOPICS, type AssignmentStatus, type ResourceKind, type ResourceStatus } from './types';

// ─── 42 CFR Part 2 ──────────────────────────────────────────────────────────

/** Content that reveals substance use treatment: an SUD topic, or flagged by staff. */
export function isSudItem(item: { topics: readonly string[]; sudRelated?: boolean | null }): boolean {
  return Boolean(item.sudRelated) || item.topics.some((t) => (SUD_TOPICS as readonly string[]).includes(t));
}

/**
 * An assignment is a Part 2 record when the content is SUD-related, the client's chart is
 * classified Part 2, or it was made from an SUD context (SUD note / SUD group / Part 2 program).
 */
export function assignmentIsPart2(input: { itemSud: boolean; clientPart2: boolean; contextPart2?: boolean }): boolean {
  return input.itemSud || input.clientPart2 || Boolean(input.contextPart2);
}

// ─── Notifications ──────────────────────────────────────────────────────────

/**
 * Patient notification wording. Identical for every assignment: never the resource title, topic,
 * clinician or message (no PHI on a lock screen, nothing that reveals SUD treatment).
 */
export const RESOURCE_NOTIFICATION_TITLE = 'New resource';
export const RESOURCE_NOTIFICATION_BODY = 'You have a new resource in your portal.';

export type NotificationPlan = {
  /** Always: the assignment shows as new in the portal ("My resources") */
  portal: true;
  /** Push to the patient's registered app devices (the patient opted in by registering a device) */
  push: boolean;
  /** Never: SMS and email are not used for resources */
  sms: false;
  email: false;
  title: string;
  body: string;
  /** Push data payload: no title, topic or clinician */
  data: Record<string, string>;
  reason: string | null;
};

export function resourceNotificationPlan(input: { assignmentId: string; part2: boolean; deviceCount: number; portalAccount: boolean }): NotificationPlan {
  const base = {
    portal: true as const,
    sms: false as const,
    email: false as const,
    title: RESOURCE_NOTIFICATION_TITLE,
    body: RESOURCE_NOTIFICATION_BODY,
    data: { type: 'resource_assigned', assignmentId: input.assignmentId },
  };
  if (!input.portalAccount) return { ...base, push: false, reason: 'no_portal_account' };
  if (input.deviceCount < 1) return { ...base, push: false, reason: 'no_registered_device' };
  return { ...base, push: true, reason: null };
}

// ─── Content validity ───────────────────────────────────────────────────────

export type ItemShape = {
  kind: ResourceKind | string;
  audience: string;
  status: ResourceStatus | string;
  url: string | null;
  body: string | null;
  contactPhone: string | null;
  fileStoredName: string | null;
  lastReviewedAt: Date | string | null;
};

/** What an item needs before it can be active (and assigned). null = ready. */
export function activationProblem(item: Omit<ItemShape, 'status' | 'audience'>): string | null {
  switch (item.kind) {
    case 'handout':
      if (!item.fileStoredName) return 'Upload the handout file first';
      if (!item.lastReviewedAt) return 'A clinician must review a practice handout before it is active';
      return null;
    case 'article':
      if (!item.body?.trim()) return 'Write the article text first';
      if (!item.lastReviewedAt) return 'A clinician must review a practice article before it is active';
      return null;
    case 'link':
    case 'video':
      return item.url ? null : 'Add the link';
    case 'crisis':
    case 'community':
      return item.url || item.contactPhone ? null : 'Add a link or phone number';
    default:
      return 'Unknown resource type';
  }
}

/** Can this item be sent to a client? */
export function assignProblem(item: ItemShape): string | null {
  if (item.audience !== 'patient') return 'Staff resources cannot be sent to clients';
  if (item.status !== 'active') return 'Only active resources can be sent';
  return activationProblem(item);
}

export function isHttpUrl(v: string | null | undefined): boolean {
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ─── Assignment status ──────────────────────────────────────────────────────

export type StatusChange = { status: AssignmentStatus; viewedAt?: Date; completedAt?: Date; withdrawnAt?: Date };

/** Patient actions: viewed (first open) and completed. Never moves backwards. */
export function patientStatusChange(
  current: { status: string; viewedAt: Date | null },
  action: 'viewed' | 'completed',
  now = new Date(),
): { ok: true; change: StatusChange | null } | { ok: false; error: string } {
  if (current.status === 'withdrawn') return { ok: false, error: 'This resource is no longer available' };
  if (action === 'viewed') {
    if (current.status !== 'sent') return { ok: true, change: null };
    return { ok: true, change: { status: 'viewed', viewedAt: now } };
  }
  if (current.status === 'completed') return { ok: true, change: null };
  return { ok: true, change: { status: 'completed', completedAt: now, ...(current.viewedAt ? {} : { viewedAt: now }) } };
}

/** Staff withdraw (sent in error / no longer appropriate). Completed work stays in the record. */
export function staffWithdrawProblem(status: string): string | null {
  if (status === 'withdrawn') return 'Already withdrawn';
  if (status === 'completed') return 'The client already completed this resource';
  return null;
}

/** Statuses a patient sees in the portal */
export const PATIENT_VISIBLE_STATUSES = ['sent', 'viewed', 'completed'] as const;

/** Portal scope: the signed-in patient's own, non-withdrawn assignments in their organization. */
export function patientAssignmentWhere(ctx: { organizationId: string; clientId: string }) {
  return { organizationId: ctx.organizationId, clientId: ctx.clientId, status: { in: [...PATIENT_VISIBLE_STATUSES] } };
}

/** Same rule in memory (tests, defensive filtering of joined rows). */
export function visibleToPatient<T extends { organizationId: string; clientId: string; status: string }>(rows: T[], ctx: { organizationId: string; clientId: string }): T[] {
  return rows.filter(
    (r) => r.organizationId === ctx.organizationId && r.clientId === ctx.clientId && (PATIENT_VISIBLE_STATUSES as readonly string[]).includes(r.status),
  );
}

// ─── Reports (pure aggregation) ─────────────────────────────────────────────

/** month: YYYY-MM in the practice time zone (falls back to UTC) */
export type AssignmentFact = { id: string; status: string; topics: string[]; assignedById: string | null; createdAt: Date; month?: string };

export type AssignmentAgg = { key: string; assigned: number; viewed: number; completed: number; withdrawn: number; open: number; completionRate: number | null };

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/**
 * Group assignments by topic (an assignment with two topics counts under both; "No topic" when
 * none), clinician or month. assigned = all rows in the bucket; completion rate excludes withdrawn.
 * viewed counts viewed or completed (completion implies it was opened).
 */
export function aggregateAssignments(rows: AssignmentFact[], dim: 'topic' | 'clinician' | 'month'): AssignmentAgg[] {
  const buckets = new Map<string, AssignmentFact[]>();
  const add = (k: string, r: AssignmentFact) => buckets.set(k, [...(buckets.get(k) ?? []), r]);
  for (const r of rows) {
    if (dim === 'topic') {
      if (!r.topics.length) add('', r);
      for (const t of new Set(r.topics)) add(t, r);
    } else if (dim === 'clinician') add(r.assignedById ?? '', r);
    else add(r.month ?? r.createdAt.toISOString().slice(0, 7), r);
  }
  return [...buckets.entries()]
    .map(([key, list]) => {
      const withdrawn = list.filter((r) => r.status === 'withdrawn').length;
      const completed = list.filter((r) => r.status === 'completed').length;
      const viewed = list.filter((r) => r.status === 'viewed' || r.status === 'completed').length;
      const live = list.length - withdrawn;
      return { key, assigned: list.length, viewed, completed, withdrawn, open: live - completed, completionRate: rate(completed, live) };
    })
    .sort((a, b) => (dim === 'month' ? a.key.localeCompare(b.key) : b.assigned - a.assigned || a.key.localeCompare(b.key)));
}

export type ReferralFact = { id: string; domain: string; status: string; referralType: string; followUpDate: Date | null; followUpCompletedAt: Date | null; closeReason: string | null };
export type FollowUpState = 'none' | 'scheduled' | 'overdue' | 'done';

export function followUpState(r: Pick<ReferralFact, 'followUpDate' | 'followUpCompletedAt' | 'status'>, today: Date): FollowUpState {
  if (r.followUpCompletedAt || r.status === 'closed') return r.followUpDate || r.followUpCompletedAt ? 'done' : 'none';
  if (!r.followUpDate) return 'none';
  const day = today.toISOString().slice(0, 10);
  return r.followUpDate.toISOString().slice(0, 10) < day ? 'overdue' : 'scheduled';
}

export type ReferralAgg = {
  key: string;
  referrals: number;
  resourceGiven: number;
  referralMade: number;
  open: number;
  connected: number;
  closed: number;
  needMet: number;
  followUpScheduled: number;
  followUpOverdue: number;
  followUpDone: number;
  noFollowUp: number;
  loopClosedRate: number | null;
};

/** Group referrals by SDOH domain or follow-up state. Every referral lands in exactly one bucket. */
export function aggregateReferrals(rows: ReferralFact[], dim: 'domain' | 'followUp', today: Date): ReferralAgg[] {
  const buckets = new Map<string, ReferralFact[]>();
  for (const r of rows) {
    const k = dim === 'domain' ? r.domain : followUpState(r, today);
    buckets.set(k, [...(buckets.get(k) ?? []), r]);
  }
  return [...buckets.entries()]
    .map(([key, list]) => {
      const fu = list.map((r) => followUpState(r, today));
      const closed = list.filter((r) => r.status === 'closed').length;
      return {
        key,
        referrals: list.length,
        resourceGiven: list.filter((r) => r.referralType === 'resource_given').length,
        referralMade: list.filter((r) => r.referralType !== 'resource_given').length,
        open: list.filter((r) => r.status === 'open').length,
        connected: list.filter((r) => r.status === 'connected').length,
        closed,
        needMet: list.filter((r) => r.status === 'closed' && r.closeReason === 'need_met').length,
        followUpScheduled: fu.filter((s) => s === 'scheduled').length,
        followUpOverdue: fu.filter((s) => s === 'overdue').length,
        followUpDone: fu.filter((s) => s === 'done').length,
        noFollowUp: fu.filter((s) => s === 'none').length,
        loopClosedRate: rate(closed, list.length),
      };
    })
    .sort((a, b) => b.referrals - a.referrals || a.key.localeCompare(b.key));
}

// ─── Recently used ──────────────────────────────────────────────────────────

export function recentItemIds(states: { itemId: string; lastUsedAt: Date | null }[], limit = 8): string[] {
  return states
    .filter((s) => s.lastUsedAt)
    .sort((a, b) => b.lastUsedAt!.getTime() - a.lastUsedAt!.getTime())
    .slice(0, limit)
    .map((s) => s.itemId);
}

/** Search across title, summary, publisher and topic labels (case-insensitive, all words must match). */
export function matchesQuery(item: { title: string; summary: string | null; publisher: string | null; topics: string[] }, q: string, topicLabel: (t: string) => string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [item.title, item.summary ?? '', item.publisher ?? '', ...item.topics.map(topicLabel), ...item.topics].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
