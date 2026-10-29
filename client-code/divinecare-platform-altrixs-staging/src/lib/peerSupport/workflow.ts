/**
 * Peer support: pure rules shared by server and page (no Prisma, no React).
 *
 * Peer notes are non-clinical: what the peer and client did together, in plain words.
 * No diagnoses, therapy content or substance-use treatment detail (42 CFR Part 2).
 */

export const PEER_SUPPORT_PATH = '/dashboard/peer-support';

/** Leadership sees every client in the org; other page roles keep their caseload rule. */
export const PEER_LEADERSHIP_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as const;
export function isPeerLeadership(role: string | null | undefined): boolean {
  return (PEER_LEADERSHIP_ROLES as readonly string[]).includes((role ?? '').toUpperCase());
}

// ─── Contacts ───────────────────────────────────────────────────────────────

export const CONTACT_MODES = ['in_person', 'phone', 'text', 'telehealth', 'community'] as const;
export type ContactMode = (typeof CONTACT_MODES)[number];
export const CONTACT_MODE_LABEL: Record<ContactMode, string> = {
  in_person: 'In person',
  phone: 'Phone',
  text: 'Text',
  telehealth: 'Telehealth',
  community: 'In the community',
};

/** Suggested tags; free tags are allowed too. */
export const SUGGESTED_TOPICS = [
  'Recovery',
  'Housing',
  'Employment',
  'Education',
  'Benefits',
  'Transportation',
  'Social connection',
  'Wellness',
  'Family',
  'Advocacy',
  'Health care navigation',
  'Crisis support',
] as const;

export const MAX_TOPICS = 12;

/** Trim, drop empties and duplicates (case-insensitive), cap count and length. */
export function normalizeTopics(input: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input ?? []) {
    const t = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

export type FollowUpState = 'overdue' | 'due_today' | 'upcoming';

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Open follow-up state by calendar day (local time). */
export function followUpState(followUpAt: Date, now = new Date()): FollowUpState {
  const a = dayKey(followUpAt);
  const b = dayKey(now);
  if (a < b) return 'overdue';
  if (a === b) return 'due_today';
  return 'upcoming';
}

// ─── Goals ──────────────────────────────────────────────────────────────────

export const GOAL_DOMAINS = [
  'recovery',
  'housing',
  'employment',
  'education',
  'social',
  'wellness',
  'family',
  'financial',
  'legal',
  'health',
  'other',
] as const;
export type GoalDomain = (typeof GOAL_DOMAINS)[number];
export const GOAL_DOMAIN_LABEL: Record<GoalDomain, string> = {
  recovery: 'Recovery',
  housing: 'Housing',
  employment: 'Employment',
  education: 'Education',
  social: 'Social connection',
  wellness: 'Wellness',
  family: 'Family',
  financial: 'Financial',
  legal: 'Legal',
  health: 'Health',
  other: 'Other',
};

export const GOAL_STATUSES = ['active', 'in_progress', 'achieved', 'on_hold', 'discontinued'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: 'Active',
  in_progress: 'In progress',
  achieved: 'Achieved',
  on_hold: 'On hold',
  discontinued: 'Discontinued',
};
export const OPEN_GOAL_STATUSES: readonly GoalStatus[] = ['active', 'in_progress', 'on_hold'];
export const isOpenGoal = (status: string) => (OPEN_GOAL_STATUSES as readonly string[]).includes(status);

export type ProgressNote = { at: string; byId: string; byName: string | null; text: string };

export function parseProgressNotes(value: unknown): ProgressNote[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((n): n is Record<string, unknown> => Boolean(n) && typeof n === 'object')
    .map((n) => ({
      at: typeof n.at === 'string' ? n.at : '',
      byId: typeof n.byId === 'string' ? n.byId : '',
      byName: typeof n.byName === 'string' ? n.byName : null,
      text: typeof n.text === 'string' ? n.text : '',
    }))
    .filter((n) => n.text && n.at);
}

// ─── Placements ─────────────────────────────────────────────────────────────

/** Community integration placements, as the old page tracked them, plus recovery residences. */
export const PLACEMENT_TYPES = [
  'competitive_employment',
  'internship',
  'volunteer',
  'education',
  'social_club',
  'housing_program',
  'recovery_residence',
] as const;
export type PlacementType = (typeof PLACEMENT_TYPES)[number];
export const PLACEMENT_TYPE_LABEL: Record<PlacementType, string> = {
  competitive_employment: 'Competitive employment',
  internship: 'Internship',
  volunteer: 'Volunteer',
  education: 'Education',
  social_club: 'Social club',
  housing_program: 'Housing program',
  recovery_residence: 'Recovery residence',
};
export const PLACEMENT_STATUSES = ['pending', 'active', 'completed', 'ended'] as const;
export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number];
export const PLACEMENT_STATUS_LABEL: Record<PlacementStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  completed: 'Completed',
  ended: 'Ended',
};

// ─── Summary ────────────────────────────────────────────────────────────────

export function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Counts from real rows only. Voided contacts never count. */
export function summarize(input: {
  now?: Date;
  caseloadSize: number;
  contacts: { clientId: string; contactAt: Date; voidedAt: Date | null; followUpAt: Date | null; followUpDoneAt: Date | null }[];
  goals: { status: string }[];
}) {
  const now = input.now ?? new Date();
  const monthStart = startOfMonth(now);
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const live = input.contacts.filter((c) => !c.voidedAt);
  const engaged = new Set(live.filter((c) => c.contactAt >= since30 && c.contactAt <= now).map((c) => c.clientId));
  const open = live.filter((c) => c.followUpAt && !c.followUpDoneAt);
  return {
    caseloadSize: input.caseloadSize,
    contactsThisMonth: live.filter((c) => c.contactAt >= monthStart && c.contactAt <= now).length,
    clientsEngaged30d: engaged.size,
    openGoals: input.goals.filter((g) => isOpenGoal(g.status)).length,
    followUpsOverdue: open.filter((c) => followUpState(c.followUpAt!, now) === 'overdue').length,
    followUpsDueToday: open.filter((c) => followUpState(c.followUpAt!, now) === 'due_today').length,
  };
}

// ─── Legacy module lists ───────────────────────────────────────────────────

export const LEGACY_MODULES = {
  contact: 'peer-contacts',
  goal: 'peer-goals',
  placement: 'peer-placements',
} as const;
export type LegacyKind = keyof typeof LEGACY_MODULES;

/**
 * The built-in sample rows shipped before the staging cleanup used ids pc-01..pc-12,
 * pg-01..pg-14, pp-01..pp-06 (sample people, not clients). Rows entered on the page
 * used `pc-<timestamp>`. Sample rows are counted and never offered for import.
 */
export function isLegacySampleId(id: string): boolean {
  return /^p[cgp]-\d{2}$/.test(id);
}

export type LegacyEntry = {
  kind: LegacyKind;
  legacyId: string;
  /** Free-text client name as typed on the old page; never matched to a chart automatically */
  clientLabel: string;
  date: string | null;
  summary: string;
  detail: string;
  /** Specialist name as typed (contacts only); a hint for the person filing it */
  author: string | null;
  /** Group rows covered several people and cannot be filed to one chart */
  group: boolean;
  suggested: Record<string, unknown>;
  raw: Record<string, unknown>;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

const LEGACY_CONTACT_MODE: Record<string, ContactMode> = {
  'Individual phone call': 'phone',
  'In-person meeting': 'in_person',
  'Group session': 'in_person',
  'Community outing': 'community',
  'Employment support': 'in_person',
  'Crisis support': 'phone',
  'Peer check-in': 'in_person',
  'Family meeting': 'in_person',
};
const LEGACY_GOAL_STATUS: Record<string, GoalStatus> = {
  Active: 'active',
  'In Progress': 'in_progress',
  Completed: 'achieved',
  'On Hold': 'on_hold',
};
const LEGACY_PLACEMENT_TYPE: Record<string, PlacementType> = {
  Volunteer: 'volunteer',
  'Competitive Employment': 'competitive_employment',
  'Social Club': 'social_club',
  'Housing Program': 'housing_program',
  Education: 'education',
  Internship: 'internship',
};
const LEGACY_PLACEMENT_STATUS: Record<string, PlacementStatus> = {
  Active: 'active',
  Pending: 'pending',
  Completed: 'completed',
  Ended: 'ended',
};

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && !Array.isArray(r)) : [];
}

/**
 * Parse one old module list. Returns entries that a user may file (sample rows and
 * rows without an id are counted, not returned). Suggestions are only form defaults.
 */
export function parseLegacyList(kind: LegacyKind, data: unknown): { entries: LegacyEntry[]; sampleRows: number; unreadable: number } {
  const entries: LegacyEntry[] = [];
  let sampleRows = 0;
  let unreadable = 0;
  for (const r of rows(data)) {
    const legacyId = str(r.id);
    if (!legacyId) {
      unreadable += 1;
      continue;
    }
    if (isLegacySampleId(legacyId)) {
      sampleRows += 1;
      continue;
    }
    const clientLabel = str(r.client);
    const group = /^group\b/i.test(clientLabel);
    if (kind === 'contact') {
      const type = str(r.contactType);
      const topics = normalizeTopics([...strList(r.topics), ...(type ? [type] : [])]);
      entries.push({
        kind,
        legacyId,
        clientLabel,
        date: str(r.date) || null,
        summary: type || 'Contact',
        detail: str(r.response),
        author: str(r.specialist) || null,
        group,
        suggested: {
          mode: LEGACY_CONTACT_MODE[type] ?? 'in_person',
          durationMinutes: num(r.duration),
          topics,
          notes: [str(r.response), strList(r.goalsAddressed).length ? `Goals addressed: ${strList(r.goalsAddressed).join(', ')}` : '']
            .filter(Boolean)
            .join('\n'),
        },
        raw: r,
      });
    } else if (kind === 'goal') {
      entries.push({
        kind,
        legacyId,
        clientLabel,
        date: str(r.targetDate) || null,
        summary: str(r.title) || 'Goal',
        detail: str(r.notes),
        author: null,
        group,
        suggested: {
          goal: str(r.title),
          status: LEGACY_GOAL_STATUS[str(r.status)] ?? 'active',
          targetDate: str(r.targetDate) || null,
          progressNote: str(r.notes) || null,
        },
        raw: r,
      });
    } else {
      const type = str(r.activityType);
      entries.push({
        kind,
        legacyId,
        clientLabel,
        date: str(r.startDate) || null,
        summary: [type, str(r.organization)].filter(Boolean).join(' — ') || 'Placement',
        detail: str(r.notes),
        author: null,
        group,
        suggested: {
          placementType: LEGACY_PLACEMENT_TYPE[type] ?? null,
          organizationName: str(r.organization),
          status: LEGACY_PLACEMENT_STATUS[str(r.status)] ?? 'pending',
          startDate: str(r.startDate) || null,
          hoursPerWeek: num(r.hoursPerWeek),
          notes: str(r.notes) || null,
        },
        raw: r,
      });
    }
  }
  return { entries, sampleRows, unreadable };
}

/** Date-only strings ("2026-10-01") are kept on that calendar day at noon local time. */
export function parseDateInput(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
