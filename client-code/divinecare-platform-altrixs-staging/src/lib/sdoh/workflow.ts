import type { AhcDomain } from './ahcHrsn';

/** Pure rules for SDOH referrals, the resource directory and rescreening (shared by page, API and tests). */

export const REFERRAL_STATUSES = ['open', 'connected', 'closed'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  open: 'Open',
  connected: 'Connected',
  closed: 'Closed',
};

/** resource_given = information handed to the client; referral_made = staff referred / contacted the agency */
export const REFERRAL_TYPES = ['resource_given', 'referral_made'] as const;
export type ReferralType = (typeof REFERRAL_TYPES)[number];
export const REFERRAL_TYPE_LABEL: Record<ReferralType, string> = { resource_given: 'Resource given', referral_made: 'Referral made' };

export const CLOSE_REASONS = ['need_met', 'declined', 'unable_to_reach', 'not_eligible', 'other'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];
export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  need_met: 'Need met',
  declined: 'Client declined',
  unable_to_reach: 'Unable to reach client',
  not_eligible: 'Not eligible / no resource',
  other: 'Other',
};

/**
 * open -> connected (client linked to the resource) | closed
 * connected -> closed | open (the connection fell through)
 * closed -> open (reopen)
 */
const TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  open: ['connected', 'closed'],
  connected: ['closed', 'open'],
  closed: ['open'],
};

export function canTransition(from: ReferralStatus, to: ReferralStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type TransitionResult =
  | { ok: true; data: { status: ReferralStatus; connectedAt?: Date | null; closedAt: Date | null; closeReason: CloseReason | null } }
  | { ok: false; error: string };

/** Field changes for a status move. Closing needs a reason; reopening clears the close fields. */
export function applyTransition(
  current: { status: ReferralStatus; connectedAt: Date | null },
  to: ReferralStatus,
  closeReason: CloseReason | null | undefined,
  now = new Date(),
): TransitionResult {
  if (current.status === to) return { ok: false, error: `Referral is already ${REFERRAL_STATUS_LABEL[to].toLowerCase()}` };
  if (!canTransition(current.status, to)) {
    return { ok: false, error: `A ${current.status} referral cannot move to ${to}` };
  }
  if (to === 'closed') {
    if (!closeReason) return { ok: false, error: 'Choose why the referral is closing' };
    return { ok: true, data: { status: 'closed', closedAt: now, closeReason } };
  }
  if (to === 'connected') return { ok: true, data: { status: 'connected', connectedAt: now, closedAt: null, closeReason: null } };
  // Back to open: keep connectedAt only when reopening a closed referral that had been connected
  return { ok: true, data: { status: 'open', connectedAt: current.status === 'connected' ? null : current.connectedAt, closedAt: null, closeReason: null } };
}

/** Directory domains (housing covers both AHC housing domains). */
export const RESOURCE_DOMAINS = [
  'housing',
  'food',
  'transportation',
  'utilities',
  'safety',
  'financial',
  'employment',
  'family_support',
  'education',
  // Community directory categories with no AHC screening domain (20261020_resource_library.sql)
  'legal',
  'domestic_violence',
  'lgbtq',
  'veterans',
  /** Information and referral lines that cover every need (e.g. 211 Maryland) */
  'general',
] as const;
export type ResourceDomain = (typeof RESOURCE_DOMAINS)[number];

export const RESOURCE_DOMAIN_LABEL: Record<ResourceDomain, string> = {
  housing: 'Housing',
  food: 'Food',
  transportation: 'Transportation',
  utilities: 'Utilities',
  safety: 'Safety',
  financial: 'Financial',
  employment: 'Employment',
  family_support: 'Family & community support',
  education: 'Education',
  legal: 'Legal aid',
  domestic_violence: 'Domestic violence',
  lgbtq: 'LGBTQ+',
  veterans: 'Veterans',
  general: 'All needs (information & referral)',
};

export function resourceDomainFor(domain: AhcDomain): ResourceDomain {
  switch (domain) {
    case 'housing_instability':
    case 'housing_quality':
      return 'housing';
    case 'financial_strain':
      return 'financial';
    default:
      return domain;
  }
}

/** Old module-blob domains (pre-Oct 2026 page) -> directory domains */
const LEGACY_DOMAIN: Record<string, ResourceDomain> = {
  housing: 'housing',
  food: 'food',
  transport: 'transportation',
  safety: 'safety',
  financial: 'financial',
  social: 'family_support',
};

export interface LegacyResourceRow {
  legacyId: string;
  name: string;
  domains: ResourceDomain[];
  phone: string | null;
  hours: string | null;
  cost: string | null;
  eligibilityNotes: string | null;
}

/** Reads the 'sdoh-resources' module blob. Rows without an id or name are skipped (never invented). */
export function parseLegacyResources(data: unknown): LegacyResourceRow[] {
  if (!Array.isArray(data)) return [];
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const out: LegacyResourceRow[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const legacyId = str(r.id, 120);
    const name = str(r.name, 200);
    if (!legacyId || !name) continue;
    const d = typeof r.domain === 'string' ? LEGACY_DOMAIN[r.domain] : undefined;
    out.push({
      legacyId,
      name,
      domains: d ? [d] : [],
      phone: str(r.phone, 60),
      hours: str(r.hours, 200),
      cost: str(r.cost, 120),
      eligibilityNotes: str(r.notes, 2000),
    });
  }
  return out;
}

export const RESCREEN_MONTHS = 12;
/** Show in the worklist from 30 days before the due date */
export const RESCREEN_WINDOW_DAYS = 30;

export function rescreenDueAt(lastCompletedAt: Date): Date {
  const d = new Date(lastCompletedAt);
  d.setMonth(d.getMonth() + RESCREEN_MONTHS);
  return d;
}

export function rescreenState(lastCompletedAt: Date, now = new Date()): 'current' | 'due_soon' | 'overdue' {
  const due = rescreenDueAt(lastCompletedAt);
  if (due.getTime() <= now.getTime()) return 'overdue';
  if (due.getTime() - now.getTime() <= RESCREEN_WINDOW_DAYS * 86_400_000) return 'due_soon';
  return 'current';
}

export function ageInDays(from: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

/** Summary maths kept pure for tests: counts in, percentages out (null when the base is 0). */
export function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}
