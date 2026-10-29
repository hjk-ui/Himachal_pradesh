/**
 * Medical Director designation: a capability flag on a prescriber's staff account (User.isMedicalDirector),
 * not a separate role. The person keeps their base role (Psychiatrist, NP, Primary Care Physician or
 * Medical NP) with its prescribing, nav and home page, and gets:
 *   - org-wide patient scope (every client in the organization, all locations) for chart reading and
 *     the clinical actions the base role already allows;
 *   - supervisor review / co-sign authority (see cosign rules in src/lib/notes/transitions.ts);
 *   - the clinical oversight pages (MEDICAL_DIRECTOR_PAGE_PREFIXES) with org-wide scope.
 * NOT granted: billing posting, HR, practice settings, staff management, platform admin, and no
 * bypass of 42 CFR Part 2 / VIP protected records (sensitiveAccess.ts is unchanged: whitelist or
 * break-the-glass with a reason, both logged).
 *
 * Two inputs, one rule:
 *   - Pure gates (canAccessPath / canAccessApiPath / buildNavForRole) take an AccessCapabilities
 *     object. The proxy builds it from the JWT claim; the dashboard layout and API routes from
 *     requireSession(), which re-reads the flag from the database (session cache TTL 10s).
 *   - Server-side patient scope (clientAccessWhere, decideChartAccess, isCaseloadScoped, audit
 *     accessBasis) reads the VERIFIED registry below, which requireSession() refreshes from the
 *     database row on every request. A missing / expired entry means "not a medical director"
 *     (fail closed to the caseload rule). invalidateSessionUser() clears it.
 *
 * No database or server imports: safe in the browser (the registry is simply empty there).
 */
import { isCaseloadRole } from '@/types/roles';

/** Base roles that may hold the designation: the clinical prescriber roles. */
export const MEDICAL_DIRECTOR_ROLES = ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'] as const;

/**
 * Behavioral-health prescriber roles. Only these count as the supervisor signature for a
 * pre-licensed behavioral-health clinician (Maryland counseling / social work boards approve
 * licensed mental-health professionals as supervisors; a primary care physician or family NP is not one).
 */
export const BEHAVIORAL_HEALTH_DIRECTOR_ROLES = ['PSYCHIATRIST', 'NP'] as const;

export const MEDICAL_DIRECTOR_LABEL = 'Medical Director';
export const MEDICAL_DIRECTOR_SCOPE_MAX = 200;

export type AccessCapabilities = {
  /** Verified (server) or claimed (JWT) Medical Director flag; only effective on an eligible active role */
  medicalDirector?: boolean;
};

function upper(role: string | null | undefined): string {
  return String(role ?? '').trim().toUpperCase();
}

export function isMedicalDirectorEligibleRole(role: string | null | undefined): boolean {
  return (MEDICAL_DIRECTOR_ROLES as readonly string[]).includes(upper(role));
}

/** May this account hold the flag? (primary role or any assigned role is a prescriber role) */
export function canHoldMedicalDirector(role: string | null | undefined, roles?: readonly (string | null | undefined)[] | null): boolean {
  return isMedicalDirectorEligibleRole(role) || (roles ?? []).some((r) => isMedicalDirectorEligibleRole(r));
}

export function isBehavioralHealthDirectorRole(role: string | null | undefined): boolean {
  return (BEHAVIORAL_HEALTH_DIRECTOR_ROLES as readonly string[]).includes(upper(role));
}

/** The flag applies only while the active role is an eligible prescriber role. */
export function medicalDirectorActive(role: string | null | undefined, caps?: AccessCapabilities | null): boolean {
  return Boolean(caps?.medicalDirector) && isMedicalDirectorEligibleRole(role);
}

/** Free-text scope note ("Primary care", "Behavioral health"): trimmed, single line, capped; empty -> null */
export function normalizeMedicalDirectorScope(input: string | null | undefined): string | null {
  const v = String(input ?? '').replace(/\s+/g, ' ').trim().slice(0, MEDICAL_DIRECTOR_SCOPE_MAX);
  return v || null;
}

/**
 * Clinical oversight pages added for a medical director (org-wide scope inside each page):
 * Clinical Insights, Service Eligibility Scanner + SUD Radar, risk / MBC alerts, Mobile Crisis,
 * Population Health, Outcomes reports, incidents / grievances / QI, supervisor review queue.
 */
export const MEDICAL_DIRECTOR_PAGE_PREFIXES = [
  '/dashboard/ai-insights',
  '/dashboard/ehr/scanner',
  '/dashboard/alerts',
  '/dashboard/mbc',
  '/dashboard/crisis',
  '/dashboard/population',
  '/dashboard/reports',
  '/dashboard/incidents',
  '/dashboard/grievances',
  '/dashboard/qi',
  '/dashboard/ehr/supervisor-review',
] as const;

/** APIs behind those pages that the proxy role gate (API_PATH_ACCESS) would otherwise refuse. */
export const MEDICAL_DIRECTOR_API_PREFIXES = [
  '/api/alerts',
  '/api/risk-alerts',
  '/api/crisis',
  '/api/insights/clinical',
  '/api/reports/outcomes',
  '/api/reports/population',
  '/api/reports/library',
  '/api/ehr/scanner',
  '/api/clinical/mbc',
  '/api/incidents',
  '/api/ehr/supervisor-review',
] as const;

function underPrefix(path: string, prefixes: readonly string[]): boolean {
  const p = path.split('?')[0] || '/';
  return prefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export function isMedicalDirectorPagePath(path: string): boolean {
  return underPrefix(path, MEDICAL_DIRECTOR_PAGE_PREFIXES);
}

export function isMedicalDirectorApiPath(path: string): boolean {
  return underPrefix(path, MEDICAL_DIRECTOR_API_PREFIXES);
}

// ─── Verified registry (server; refreshed by requireSession from the DB row) ──

type VerifiedEntry = { organizationId: string | null; medicalDirector: boolean; expiresAt: number };

/** Shared across Next.js server bundles through globalThis, like one process-wide cache. */
const store = globalThis as unknown as { __altrixsVerifiedCapabilities?: Map<string, VerifiedEntry> };
const registry: Map<string, VerifiedEntry> = (store.__altrixsVerifiedCapabilities ??= new Map());
const REGISTRY_MAX = 5000;

/** Called by requireSession after it re-reads the user's row (never from a JWT claim alone). */
export function recordVerifiedCapabilities(
  userId: string,
  input: { organizationId: string | null; medicalDirector: boolean },
  ttlMs: number,
  now = Date.now(),
): void {
  if (!userId) return;
  if (!input.medicalDirector) {
    registry.delete(userId);
    return;
  }
  if (registry.size >= REGISTRY_MAX && !registry.has(userId)) {
    const first = registry.keys().next();
    if (!first.done) registry.delete(first.value);
  }
  registry.set(userId, { organizationId: input.organizationId, medicalDirector: true, expiresAt: now + ttlMs });
}

/** Revocation / role change: drop the verified entry immediately. */
export function forgetVerifiedCapabilities(userId: string): void {
  registry.delete(userId);
}

export type ScopeActor = { userId: string; role: string | null | undefined; organizationId?: string | null };

/**
 * Org-wide clinical scope for this request's actor: a database-verified medical director, whose
 * active role is an eligible prescriber role, in the same organization. Never true across orgs.
 */
export function verifiedMedicalDirector(actor: ScopeActor, now = Date.now()): boolean {
  if (!actor?.userId || !isMedicalDirectorEligibleRole(actor.role)) return false;
  const e = registry.get(actor.userId);
  if (!e) return false;
  if (e.expiresAt <= now) {
    registry.delete(actor.userId);
    return false;
  }
  if (!e.medicalDirector || !e.organizationId) return false;
  if (actor.organizationId !== undefined && actor.organizationId !== e.organizationId) return false;
  return true;
}

/** Capabilities object for a server actor (route gates that take AccessCapabilities). */
export function verifiedCapabilitiesFor(actor: ScopeActor): AccessCapabilities {
  return { medicalDirector: verifiedMedicalDirector(actor) };
}

/**
 * THE caseload rule for server code: a caseload role is limited to its own clients unless the
 * actor is a verified medical director (org-wide). Use instead of isCaseloadRole(role) wherever
 * the question is "limit to this user's clients?" (not "is this a clinical role?").
 */
export function isCaseloadScoped(actor: ScopeActor): boolean {
  return isCaseloadRole(actor.role) && !verifiedMedicalDirector(actor);
}

/** Audit metadata: why this actor could open the record (merged into every audit row's metadata). */
export function accessBasisFor(actor: ScopeActor): 'medical_director' | null {
  return verifiedMedicalDirector(actor) ? 'medical_director' : null;
}
