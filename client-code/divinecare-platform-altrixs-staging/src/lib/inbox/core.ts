import { scopedKey, TimeoutError, withTimeout, type TtlCache } from '../perf/cache';
import { sectionDef, sectionsForRole } from './sections';
import { INBOX_GROUP_LABEL } from './types';
import type {
  InboxDraft,
  InboxGroup,
  InboxGroupKey,
  InboxItem,
  InboxPriority,
  InboxSectionKey,
  InboxSectionResult,
  InboxSummary,
} from './types';

/** Pure inbox logic. No database access here, so it can be unit tested; service.ts binds the loaders. */

export const PROTECTED_DISPLAY = 'Protected record';
export const UNSIGNED_NOTE_HOURS = 24;
export const AUTH_EXPIRY_DAYS = 14;
export const AUTH_VISITS_LEFT = 3;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const DAY_MS = 86_400_000;

export const PRIORITY_RANK: Record<InboxPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export type InboxActor = { organizationId: string; userId: string; role: string };

// ─── Medicaid attestations (Carelon non-overlap) ─────────────────────────────

export const CARELON_INBOX_CAP = 200;

type CarelonInboxRow = {
  clientId: string;
  clientName: string;
  state: 'not_required' | 'not_started' | 'pending_client' | 'pending_provider' | 'needs_new' | 'complete';
  neededReason: string | null;
  completedAt: string | null;
};

const CARELON_TITLE: Record<string, string> = {
  not_started: 'Carelon attestation not started',
  pending_client: 'Carelon attestation sent, waiting for client',
  pending_provider: 'Carelon attestation: provider signature needed',
  needs_new: 'New Carelon attestation needed',
};

/**
 * One inbox item per Medicaid client needing the attestation. High: a visit in the next 7 days,
 * a new attestation requested, or the client signed and the provider has not. Capped (the full
 * list is on /dashboard/ehr/consents/carelon).
 */
export function carelonInboxDrafts(rows: CarelonInboxRow[], upcoming: Map<string, string>): { drafts: InboxDraft[]; notice: string | null } {
  const need = rows.filter((r) => r.state !== 'complete' && r.state !== 'not_required');
  const drafts: InboxDraft[] = need.map((r) => {
    const visit = upcoming.get(r.clientId) ?? null;
    const priority: InboxPriority = visit || r.state === 'needs_new' || r.state === 'pending_provider' ? 'high' : r.state === 'pending_client' ? 'low' : 'normal';
    return {
      entityKey: `carelon:${r.clientId}`,
      title: CARELON_TITLE[r.state] ?? 'Carelon attestation needed',
      detail: [r.state === 'needs_new' && r.neededReason ? r.neededReason : null, visit ? 'Visit in the next 7 days: complete at check-in' : null].filter(Boolean).join(' · ') || 'Maryland Medicaid: one completed attestation on file is required',
      clientId: r.clientId,
      clientName: r.clientName,
      priority,
      since: visit,
      href: `/dashboard/ehr/consents/carelon/${encodeURIComponent(r.clientId)}`,
      hrefLabel: 'Open form',
      action: null,
    };
  });
  const byKey = new Map(drafts.map((d) => [d.entityKey, d]));
  const sorted = sortInboxItems(drafts.map((d) => ({ ...d, id: d.entityKey }))).map((d) => byKey.get(d.id)!);
  const capped = sorted.slice(0, CARELON_INBOX_CAP);
  return {
    drafts: capped,
    notice: sorted.length > capped.length ? `Showing ${capped.length} of ${sorted.length}; the full list is on Consents > Carelon attestations.` : null,
  };
}

// ─── Consents to complete (consent library) ──────────────────────────────────

export const CONSENT_INBOX_CAP = 200;

type ConsentInboxRow = { clientId: string; clientName: string; title: string; state: string; required: boolean; needsAction: boolean };

/**
 * One inbox item per client with required consents needing action (missing, expired, revoked,
 * new version to re-sign, declined); "sent, awaiting signature" alone is low priority. High: a
 * visit in the next 7 days. Same rows as the "Consent compliance" report.
 */
export function consentInboxDrafts(rows: ConsentInboxRow[], upcoming: Map<string, string>): { drafts: InboxDraft[]; notice: string | null } {
  const byClient = new Map<string, ConsentInboxRow[]>();
  for (const r of rows) if (r.required && r.needsAction) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);
  const drafts: InboxDraft[] = [...byClient.entries()].map(([clientId, list]) => {
    const visit = upcoming.get(clientId) ?? null;
    const action = list.filter((r) => r.state !== 'pending');
    const priority: InboxPriority = action.length ? (visit ? 'high' : 'normal') : 'low';
    const titles = (action.length ? action : list).map((r) => r.title);
    return {
      entityKey: `consents:${clientId}`,
      title: action.length ? `${action.length} required consent${action.length === 1 ? '' : 's'} to complete` : 'Consent packet sent, waiting for client',
      detail: [titles.slice(0, 3).join('; ') + (titles.length > 3 ? '; ...' : ''), visit ? 'Visit in the next 7 days: complete at check-in' : null].filter(Boolean).join(' · '),
      clientId,
      clientName: list[0].clientName,
      priority,
      since: visit,
      href: `/dashboard/ehr/consents/client/${encodeURIComponent(clientId)}`,
      hrefLabel: 'Open consents',
      action: null,
    };
  });
  const byKey = new Map(drafts.map((d) => [d.entityKey, d]));
  const sorted = sortInboxItems(drafts.map((d) => ({ ...d, id: d.entityKey }))).map((d) => byKey.get(d.id)!);
  const capped = sorted.slice(0, CONSENT_INBOX_CAP);
  return { drafts: capped, notice: sorted.length > capped.length ? `Showing ${capped.length} of ${sorted.length}; the full list is in Reports > Consent compliance.` : null };
}

/** Priority first, then oldest first (no time sorts last), then title so the order is stable */
export function compareInboxItems(a: Pick<InboxItem, 'priority' | 'since' | 'title' | 'id'>, b: Pick<InboxItem, 'priority' | 'since' | 'title' | 'id'>) {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p) return p;
  const at = a.since ? Date.parse(a.since) : Number.POSITIVE_INFINITY;
  const bt = b.since ? Date.parse(b.since) : Number.POSITIVE_INFINITY;
  if (at !== bt) return at < bt ? -1 : 1;
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export function sortInboxItems<T extends Pick<InboxItem, 'priority' | 'since' | 'title' | 'id'>>(items: T[]): T[] {
  return [...items].sort(compareInboxItems);
}

/**
 * Part 2 / protected records. `locked` holds the client ids the viewer may not open; null means the
 * lookup failed, so every row with a client is treated as locked (fail closed).
 * Masked rows keep priority, age and a chart link (where break-glass is requested) and nothing else.
 */
export function applyPart2(
  section: InboxSectionKey,
  drafts: InboxDraft[],
  locked: Set<string> | null
): InboxItem[] {
  const def = sectionDef(section);
  const out: InboxItem[] = [];
  drafts.forEach((d, i) => {
    const isLocked = Boolean(d.clientId) && (locked === null || locked.has(d.clientId as string));
    if (isLocked && def.part2 === 'drop') return;
    const id = `${section}:${d.entityKey}:${i}`;
    if (isLocked) {
      out.push({
        id,
        section,
        entityKey: d.entityKey,
        title: def.protectedTitle,
        detail: null,
        clientId: d.clientId,
        clientDisplay: PROTECTED_DISPLAY,
        protected: true,
        priority: d.priority,
        since: d.since,
        href: `/dashboard/clients/${encodeURIComponent(d.clientId as string)}`,
        hrefLabel: 'Open chart',
        action: null,
        // A masked row stays in its collapsed group (never promoted to the counted list)
        ...(d.group ? { group: d.group } : {}),
      });
      return;
    }
    const { clientName, ...rest } = d;
    out.push({ ...rest, id, section, clientDisplay: clientName, protected: false });
  });
  return out;
}

/** Main list vs collapsed secondary groups (group order follows INBOX_GROUP_LABEL) */
export function splitGroups(items: InboxItem[]): { items: InboxItem[]; groups: InboxGroup[] } {
  const main: InboxItem[] = [];
  const byGroup = new Map<InboxGroupKey, InboxItem[]>();
  for (const item of items) {
    if (!item.group) {
      main.push(item);
      continue;
    }
    byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item]);
  }
  const groups = (Object.keys(INBOX_GROUP_LABEL) as InboxGroupKey[])
    .filter((k) => byGroup.has(k))
    .map((k) => ({ key: k, label: INBOX_GROUP_LABEL[k], items: byGroup.get(k)! }));
  return { items: main, groups };
}

/** "All": an entity listed by two sections appears once, preferring the dedicated section over To-Do */
export function dedupeAcrossSections(items: InboxItem[]): InboxItem[] {
  const chosen = new Map<string, InboxItem>();
  for (const item of sortInboxItems(items)) {
    const prev = chosen.get(item.entityKey);
    if (!prev) {
      chosen.set(item.entityKey, item);
    } else if (prev.section === 'tasks' && item.section !== 'tasks') {
      // Keep the more urgent priority of the two
      const priority = PRIORITY_RANK[prev.priority] < PRIORITY_RANK[item.priority] ? prev.priority : item.priority;
      chosen.set(item.entityKey, { ...item, priority });
    }
  }
  return sortInboxItems([...chosen.values()]);
}

export function parsePaging(pageRaw: string | null, sizeRaw: string | null) {
  const page = Math.max(1, Math.floor(Number(pageRaw) || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(sizeRaw) || DEFAULT_PAGE_SIZE)));
  return { page, pageSize };
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

// ─── Source rules ──────────────────────────────────────────────────────────────

/** Notes older than the practice's signing deadline (Practice settings › Clinical; default 24h). */
export function unsignedNoteCutoff(now: Date, deadlineHours: number = UNSIGNED_NOTE_HOURS) {
  const hours = Number.isFinite(deadlineHours) && deadlineHours > 0 ? deadlineHours : UNSIGNED_NOTE_HOURS;
  return new Date(now.getTime() - hours * 3_600_000);
}

/**
 * "Plan needed by <date>": a client whose therapy progress note this clinician signed under the
 * go-live transition (treatment plan pending) and who still has no active plan. Urgent once the
 * transition has ended (further notes for the client cannot be signed), high in its last 7 days.
 */
export function planPendingInboxDraft(
  c: { clientId: string; clientName: string; noteCount: number; lastSignedAt: string | null; until: string },
  today: string
): InboxDraft {
  const lastWeek = new Date(`${c.until}T12:00:00Z`);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const priority: InboxPriority = today > c.until ? 'urgent' : today >= lastWeek.toISOString().slice(0, 10) ? 'high' : 'normal';
  return {
    entityKey: `plan-pending:${c.clientId}`,
    title: `Plan needed by ${c.until}`,
    detail: `${c.noteCount} progress note${c.noteCount === 1 ? '' : 's'} signed with the treatment plan pending (go-live transition)${today > c.until ? ' · transition ended: new notes cannot be signed until the plan is signed' : ''}`,
    clientId: c.clientId,
    clientName: c.clientName,
    priority,
    since: c.lastSignedAt,
    href: `/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(c.clientId)}`,
    hrefLabel: 'Write treatment plan',
    action: null,
  };
}

/** Treatment plan review coming due (owner: 7 days before by default; supervisor when the practice sets it). */
export function planReviewInboxDraft(r: {
  planId: string;
  clientId: string;
  clientName: string;
  title: string;
  audience: 'owner' | 'supervisor';
  reminder: { due: string; remindFrom: string; daysLeft: number; overdue: boolean };
}): InboxDraft {
  const { due, daysLeft, overdue } = r.reminder;
  const when = overdue ? `overdue since ${due}` : daysLeft === 0 ? 'due today' : `due ${due} (${daysLeft} day${daysLeft === 1 ? '' : 's'})`;
  return {
    entityKey: `plan-review:${r.planId}`,
    title: `Treatment plan review ${when}`,
    detail: `${r.title}${r.audience === 'supervisor' ? ' · your supervisee’s plan' : ''}${overdue ? ' · progress notes cannot be signed until the review is signed' : ''}`,
    clientId: r.clientId,
    clientName: r.clientName,
    priority: overdue ? 'urgent' : daysLeft <= 2 ? 'high' : 'normal',
    since: `${r.reminder.remindFrom}T12:00:00.000Z`,
    href: `/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(r.clientId)}&kind=Review`,
    hrefLabel: r.audience === 'owner' ? 'Start plan review' : 'Open plan review',
    action: null,
  };
}

/** A thread needs attention when it is open and has unread messages or is waiting on staff */
export function isThreadAwaiting(t: { status: string; unreadCount: number }) {
  return t.status !== 'resolved' && (t.unreadCount > 0 || t.status === 'waiting');
}

export type AuthAttention = { daysLeft: number | null; visitsLeft: number; expired: boolean; reasons: string[] };

/** An approved authorization that ends within 14 days (or already ended) or has 3 or fewer visits left */
export function authAttention(
  auth: { status: string; endDate: Date | null; unitsApproved: number; unitsUsed: number },
  now: Date
): AuthAttention | null {
  if (auth.status !== 'APPROVED') return null;
  const visitsLeft = auth.unitsApproved - auth.unitsUsed;
  const daysLeft = auth.endDate ? Math.ceil((auth.endDate.getTime() - now.getTime()) / DAY_MS) : null;
  const reasons: string[] = [];
  if (daysLeft != null && daysLeft <= AUTH_EXPIRY_DAYS) {
    reasons.push(daysLeft < 0 ? `ended ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago` : `ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`);
  }
  if (visitsLeft <= AUTH_VISITS_LEFT) reasons.push(`${Math.max(visitsLeft, 0)} of ${auth.unitsApproved} visits left`);
  if (!reasons.length) return null;
  return { daysLeft, visitsLeft, expired: daysLeft != null && daysLeft < 0, reasons };
}

export function authPriority(a: AuthAttention): InboxPriority {
  if (a.expired || a.visitsLeft <= 0) return 'urgent';
  if ((a.daysLeft != null && a.daysLeft <= 7) || a.visitsLeft <= 1) return 'high';
  return 'normal';
}

/** To-Do task ids encode their source row; map them to the keys the dedicated sections use */
export function taskEntityKey(taskId: string): string {
  const m = /^(note|alert|sud-referral|pa-expiring|pa-units)-(.+)$/.exec(taskId);
  if (!m) return `task:${taskId}`;
  if (m[1] === 'note') return `note:${m[2]}`;
  if (m[1] === 'alert' || m[1] === 'sud-referral') return `riskAlert:${m[2]}`;
  return `priorAuth:${m[2]}`;
}

export function truncate(text: string | null | undefined, max = 160): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ─── Orchestration ────────────────────────────────────────────────────────────

export type InboxDeps = {
  loaders: Record<InboxSectionKey, (actor: InboxActor, now: Date) => Promise<{ drafts: InboxDraft[]; notice?: string | null }>>;
  /** Client ids the actor may not open (Part 2). Throwing makes every client row locked. */
  lockedClientIds: (actor: InboxActor, clientIds: string[]) => Promise<Set<string>>;
  /**
   * Short per-viewer cache of section results, shared by GET /api/inbox/summary, /items and the
   * role home. Keyed org + user + role + section (scopedKey), so rows are never shared across viewers.
   */
  cache?: TtlCache<InboxSectionResult>;
  /**
   * A section slower than this is answered as "still loading" (partial result) instead of holding
   * the whole inbox; the computation keeps running and fills the cache for the next refresh.
   */
  timeoutMs?: number;
  /** Server-Timing hook: per-section duration and whether it came from the cache */
  onTiming?: (key: InboxSectionKey, ms: number, outcome: 'hit' | 'computed' | 'timeout' | 'error') => void;
};

export const SECTION_TIMEOUT_ERROR = 'This section is taking longer than usual; it will appear on the next refresh';

export function inboxCacheKey(actor: InboxActor, key: InboxSectionKey) {
  return scopedKey(actor, 'inbox', key);
}

/** Loader + Part 2 masking. Throws when the loader fails (so failures are never cached). */
async function computeSection(
  actor: InboxActor,
  key: InboxSectionKey,
  deps: InboxDeps,
  now: Date
): Promise<{ result: InboxSectionResult; cacheable: boolean }> {
  const { drafts, notice } = await deps.loaders[key](actor, now);
  const ids = [...new Set(drafts.map((d) => d.clientId).filter((x): x is string => Boolean(x)))];
  let locked: Set<string> | null = new Set();
  if (ids.length) {
    try {
      locked = await deps.lockedClientIds(actor, ids);
    } catch (err) {
      console.error('[inbox] sensitive access lookup failed', err instanceof Error ? err.name : 'unknown');
      locked = null;
    }
  }
  const { items, groups } = splitGroups(sortInboxItems(applyPart2(key, drafts, locked)));
  return {
    result: { key, items, ...(groups.length ? { groups } : {}), notice: notice ?? null, error: null },
    // A fail-closed (lookup failed) result is shown but not cached, so the next read retries
    cacheable: locked !== null,
  };
}

export async function loadSection(
  actor: InboxActor,
  key: InboxSectionKey,
  deps: InboxDeps,
  now: Date,
  opts: { fresh?: boolean } = {}
): Promise<InboxSectionResult> {
  const started = Date.now();
  let outcome: 'hit' | 'computed' = 'computed';
  let work: Promise<InboxSectionResult>;
  if (deps.cache) {
    const cacheKey = inboxCacheKey(actor, key);
    const hit = opts.fresh ? undefined : deps.cache.get(cacheKey);
    if (hit) {
      outcome = 'hit';
      work = Promise.resolve(hit);
    } else {
      let cacheable = true;
      work = deps.cache.getOrCompute(
        cacheKey,
        async () => {
          const r = await computeSection(actor, key, deps, now);
          cacheable = r.cacheable;
          return r.result;
        },
        { fresh: opts.fresh, shouldCache: () => cacheable }
      );
    }
  } else {
    work = computeSection(actor, key, deps, now).then((r) => r.result);
  }
  // A late failure after a timeout must not surface as an unhandled rejection
  work.catch(() => {});
  try {
    const result = deps.timeoutMs ? await withTimeout(work, deps.timeoutMs, `inbox ${key}`) : await work;
    deps.onTiming?.(key, Date.now() - started, outcome);
    return result;
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.warn(`[inbox] ${key} exceeded ${deps.timeoutMs}ms; returning partial inbox`);
      deps.onTiming?.(key, Date.now() - started, 'timeout');
      return { key, items: [], notice: null, error: SECTION_TIMEOUT_ERROR };
    }
    console.error(`[inbox] ${key} failed`, err instanceof Error ? err.message : 'unknown');
    deps.onTiming?.(key, Date.now() - started, 'error');
    return { key, items: [], notice: null, error: 'Could not load this section' };
  }
}

/** Every section the role may see, loaded in parallel; one failing or slow section does not hide the others */
export async function loadAllSections(actor: InboxActor, deps: InboxDeps, now: Date, opts: { fresh?: boolean } = {}) {
  return Promise.all(sectionsForRole(actor.role).map((s) => loadSection(actor, s.key, deps, now, opts)));
}

export function summarizeInbox(results: InboxSectionResult[], now: Date): InboxSummary {
  const all = dedupeAcrossSections(results.flatMap((r) => r.items));
  return {
    total: all.length,
    urgent: all.filter((i) => i.priority === 'urgent').length,
    generatedAt: now.toISOString(),
    sections: results.map((r) => ({
      key: r.key,
      label: sectionDef(r.key).label,
      count: r.error ? null : r.items.length,
      urgent: r.items.filter((i) => i.priority === 'urgent').length,
      notice: r.notice,
      error: r.error,
    })),
  };
}
