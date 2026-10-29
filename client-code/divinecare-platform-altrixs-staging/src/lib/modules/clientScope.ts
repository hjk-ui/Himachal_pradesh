/**
 * Caseload scope for ClinicModuleState lists that hold per-client records (safety plans, discharge
 * cases, the Part 2 roster, outcome schedules / responses, legacy EHR lists ...).
 *
 * These modules are one org-wide JSON list each, so before this a page role saw every client's rows.
 * Minimum necessary (45 CFR 164.502(b)) and 42 CFR Part 2: the generic /api/modules route now
 *   - GET: returns only the items whose client the caller may open (clientAccessWhere: caseload /
 *     care team for caseload and primary care roles, org-wide for leadership, operations and a
 *     verified Medical Director) and drops items of Part 2 / sensitive clients the caller cannot open
 *     (lockedSensitiveClientIds: no whitelist, no live break-the-glass grant);
 *   - PUT: every item the caller sends must be one they may see (else 403), and the items they cannot
 *     see are kept unchanged (merged back), so a caseload save never deletes or overwrites another
 *     clinician's rows.
 * Items with no client link (legacy rows saved with a name only) are shown to org-wide roles only
 * (fail closed for caseload roles); scripts/backfill-module-client-ids.ts links them by exact name.
 *
 * Pure (no database): the server loader is src/lib/modules/clientScopeServer.ts.
 */

type Item = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Default: clientId, else patientId. */
function clientOrPatientId(item: Item): string | null {
  return str(item.clientId) ?? str(item.patientId);
}

/**
 * Module key -> how to read the client id from one item. Billing modules (claims, invoices,
 * superbills, autopay) are not here: their roles (Billing, Front Desk, Office Manager, leadership)
 * are org-wide by design and payment disclosures follow the Part 2 consent, not the caseload.
 */
export const CLIENT_SCOPED_MODULES: Record<string, (item: Item) => string | null> = {
  'ehr-safety-plans': clientOrPatientId,
  'ehr-discharge-cases': clientOrPatientId,
  // Part 2 roster: one row per client and the row id IS the client id (consents carry clientId too)
  'part2-clients': (item) => str(item.clientId) ?? str(item.id),
  'outcome-schedules': clientOrPatientId,
  'outcome-responses': clientOrPatientId,
  'mbc-schedules': clientOrPatientId,
  'patient-surveys': clientOrPatientId,
  'ehr-overview-revals': clientOrPatientId,
  'sdoh-screenings': clientOrPatientId,
  'prp-participants': clientOrPatientId,
  'ai-insights': clientOrPatientId,
  'ai-session-history': clientOrPatientId,
  'scribe-accepted-suggestions': clientOrPatientId,
  'assessment-due': clientOrPatientId,
  'mandatory-reporting': clientOrPatientId,
  'prior-auth': clientOrPatientId,
  referrals: clientOrPatientId,
  'referral-audit': clientOrPatientId,
  // Legacy EHR lists (now relational; the generic route still serves the old blobs read-only-ish)
  diagnoses: clientOrPatientId,
  evaluations: clientOrPatientId,
  locus: clientOrPatientId,
  prescriptions: clientOrPatientId,
  'prescription-refills': clientOrPatientId,
};

export function isClientScopedModule(module: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLIENT_SCOPED_MODULES, module);
}

export function moduleItemClientId(module: string, item: unknown): string | null {
  const read = CLIENT_SCOPED_MODULES[module];
  if (!read || !item || typeof item !== 'object' || Array.isArray(item)) return null;
  return read(item as Item);
}

/** Stable identity of an item (used to stop a write from replacing an item the caller cannot see). */
export function moduleItemKey(item: unknown): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const r = item as Item;
  return str(r.id) ?? str(r.scheduleId) ?? str(r.responseId) ?? str(r.surveyId);
}

export type ModuleClientScope = {
  /** Caseload / care-team roles (not a verified Medical Director): only their clients. */
  caseloadScoped: boolean;
  /** Candidate ids that are real clients of the organization. */
  known: Set<string>;
  /** Of `known`: the clients the caller may open (clientAccessWhere). */
  accessible: Set<string>;
  /** Of `known`: Part 2 / sensitive clients the caller may not open (lockedSensitiveClientIds). */
  locked: Set<string>;
};

/** May the caller see an item linked to this client id (null = no link)? */
export function moduleItemVisible(scope: ModuleClientScope, clientId: string | null): boolean {
  if (!clientId || !scope.known.has(clientId)) return !scope.caseloadScoped;
  if (scope.locked.has(clientId)) return false;
  return scope.accessible.has(clientId);
}

/** Every client id referenced by a list (for the one scope query). */
export function moduleCandidateClientIds(module: string, ...lists: unknown[]): string[] {
  const ids = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const id = moduleItemClientId(module, item);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * GET: the items the caller may see. A stored value that is not a list is returned to org-wide
 * roles unchanged and to caseload roles as an empty list (fail closed).
 */
export function filterModuleItems(module: string, data: unknown, scope: ModuleClientScope): unknown {
  if (data == null) return data;
  if (!Array.isArray(data)) return scope.caseloadScoped ? [] : data;
  return data.filter((item) => moduleItemVisible(scope, moduleItemClientId(module, item)));
}

export type ScopedWriteResult =
  | { ok: true; data: unknown[]; hiddenKept: number }
  | { ok: false; status: 400 | 403; error: string };

/**
 * PUT: merge the caller's list with the stored items they cannot see. Refused (403) when the caller
 * sends an item for a client they may not open, or an item whose id is one of the hidden items.
 */
export function mergeScopedModuleWrite(
  module: string,
  stored: unknown,
  incoming: unknown,
  scope: ModuleClientScope,
): ScopedWriteResult {
  if (!Array.isArray(incoming)) {
    return { ok: false, status: 400, error: 'This module stores a list of records' };
  }
  const storedList = Array.isArray(stored) ? stored : [];
  const hidden = storedList.filter((item) => !moduleItemVisible(scope, moduleItemClientId(module, item)));
  const hiddenKeys = new Set(hidden.map(moduleItemKey).filter((k): k is string => Boolean(k)));
  for (const item of incoming) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, status: 400, error: 'Invalid record' };
    }
    const clientId = moduleItemClientId(module, item);
    if (!moduleItemVisible(scope, clientId)) {
      return {
        ok: false,
        status: 403,
        error: clientId ? 'A record is for a client outside your caseload or a protected record' : 'Choose a client from your caseload for every record',
      };
    }
    const key = moduleItemKey(item);
    if (key && hiddenKeys.has(key)) {
      return { ok: false, status: 403, error: 'A record you cannot open has the same id' };
    }
  }
  return { ok: true, data: [...incoming, ...hidden], hiddenKept: hidden.length };
}
