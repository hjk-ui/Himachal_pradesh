/**
 * Consents worklist (pure, browser-safe): the front-desk hub's "missing / expiring / expired /
 * revoked" list, grouped by client, with filters and counts. Counts are computed from the same
 * filtered rows as the list (status filter excluded), so every count equals its list.
 */
import type { ComplianceRow } from './status';
import { STAFF_PREPARED_KEYS, type StandardStatus } from './requirements';

export const WORKLIST_PROGRAMS = ['omhc', 'sud', 'prp', 'primary_care', 'aot', 'telehealth', 'minor'] as const;
export type WorklistProgram = (typeof WORKLIST_PROGRAMS)[number];
export const PROGRAM_LABEL: Record<WorklistProgram, string> = {
  omhc: 'Outpatient mental health',
  sud: 'SUD / Part 2',
  prp: 'PRP',
  primary_care: 'Primary care',
  aot: 'AOT',
  telehealth: 'Telehealth',
  minor: 'Minors (under 18)',
};

export type WorklistFacets = {
  locationId: string | null;
  locationName: string | null;
  clinicianId: string | null;
  clinicianName: string | null;
  programs: WorklistProgram[];
  /** Next scheduled visit: practice-local date (YYYY-MM-DD) */
  nextVisit: string | null;
  /** Next scheduled visit start (ISO, for display) */
  nextVisitAt: string | null;
};

export type WorklistStatusFilter = StandardStatus | 'needs_attention' | 'all';

export type WorklistFilters = {
  locationId?: string | null;
  clinicianId?: string | null;
  program?: WorklistProgram | null;
  templateKey?: string | null;
  status?: WorklistStatusFilter | null;
  /** Clients whose next visit is on or before this practice date (YYYY-MM-DD) */
  dueBefore?: string | null;
  search?: string | null;
};

export type WorklistItem = Pick<ComplianceRow, 'itemKey' | 'templateKey' | 'title' | 'state' | 'standard' | 'detail' | 'signedAt' | 'expiresAt' | 'revokedAt' | 'daysToExpiry' | 'rowId' | 'reason'> & {
  /** Can go in a bulk "send packet" (not staff-prepared, not revoked / declined by the client, not already sent) */
  bulkSendable: boolean;
};

export type WorklistClient = {
  clientId: string;
  clientName: string;
  mrn: string | null;
  facets: WorklistFacets;
  items: WorklistItem[];
  counts: Record<StandardStatus, number>;
  /** An unsigned portal packet is already out (bulk send reminds instead of sending a new one) */
  openPacketId: string | null;
  bulkSendable: boolean;
};

export type WorklistCounts = Record<StandardStatus, number> & { needsAttention: number; clients: number; clientsNeedingAttention: number };

const emptyCounts = (): Record<StandardStatus, number> => ({ complete: 0, missing: 0, expiring: 0, expired: 0, revoked: 0 });

/** Bulk "send packet": the client must re-sign / sign it and nobody needs to prepare it first. */
export function isBulkSendable(r: Pick<ComplianceRow, 'standard' | 'state' | 'templateKey'>): boolean {
  if (STAFF_PREPARED_KEYS.has(r.templateKey)) return false;
  if (r.standard === 'expiring') return true;
  return r.standard === 'missing' || r.standard === 'expired' ? r.state === 'missing' || r.state === 'expired' || r.state === 'needs_resign' : false;
}

function facetMatch(f: WorklistFacets | undefined, filters: WorklistFilters): boolean {
  if (!f) return !filters.locationId && !filters.clinicianId && !filters.program && !filters.dueBefore;
  if (filters.locationId && f.locationId !== filters.locationId) return false;
  if (filters.clinicianId && f.clinicianId !== filters.clinicianId) return false;
  if (filters.program && !f.programs.includes(filters.program)) return false;
  if (filters.dueBefore && !(f.nextVisit && f.nextVisit.slice(0, 10) <= filters.dueBefore)) return false;
  return true;
}

export function statusMatch(standard: StandardStatus, s: WorklistStatusFilter | null | undefined): boolean {
  const f = s ?? 'needs_attention';
  if (f === 'all') return true;
  if (f === 'needs_attention') return standard !== 'complete';
  return standard === f;
}

export function buildWorklist(
  rows: ComplianceRow[],
  facets: Map<string, WorklistFacets>,
  filters: WorklistFilters,
  openPackets: Map<string, string> = new Map()
): { clients: WorklistClient[]; counts: WorklistCounts } {
  const q = (filters.search ?? '').trim().toLowerCase();
  const scoped = rows.filter(
    (r) =>
      r.required &&
      (!filters.templateKey || r.templateKey === filters.templateKey) &&
      facetMatch(facets.get(r.clientId), filters) &&
      (!q || r.clientName.toLowerCase().includes(q) || (r.mrn ?? '').toLowerCase().includes(q))
  );
  const counts: WorklistCounts = { ...emptyCounts(), needsAttention: 0, clients: 0, clientsNeedingAttention: 0 };
  const allClients = new Set<string>();
  const attention = new Set<string>();
  for (const r of scoped) {
    counts[r.standard] += 1;
    allClients.add(r.clientId);
    if (r.standard !== 'complete') {
      counts.needsAttention += 1;
      attention.add(r.clientId);
    }
  }
  counts.clients = allClients.size;
  counts.clientsNeedingAttention = attention.size;

  const byClient = new Map<string, WorklistClient>();
  for (const r of scoped) {
    if (!statusMatch(r.standard, filters.status)) continue;
    let c = byClient.get(r.clientId);
    if (!c) {
      c = {
        clientId: r.clientId,
        clientName: r.clientName,
        mrn: r.mrn,
        facets: facets.get(r.clientId) ?? { locationId: null, locationName: null, clinicianId: null, clinicianName: null, programs: [], nextVisit: null, nextVisitAt: null },
        items: [],
        counts: emptyCounts(),
        openPacketId: openPackets.get(r.clientId) ?? null,
        bulkSendable: false,
      };
      byClient.set(r.clientId, c);
    }
    const bulk = isBulkSendable(r);
    c.items.push({
      itemKey: r.itemKey,
      templateKey: r.templateKey,
      title: r.title,
      state: r.state,
      standard: r.standard,
      detail: r.detail,
      signedAt: r.signedAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      daysToExpiry: r.daysToExpiry,
      rowId: r.rowId,
      reason: r.reason,
      bulkSendable: bulk,
    });
    c.counts[r.standard] += 1;
    if (bulk || (c.openPacketId && r.state === 'pending')) c.bulkSendable = true;
  }
  const clients = [...byClient.values()].sort((a, b) => {
    const av = a.facets.nextVisitAt ?? '9999';
    const bv = b.facets.nextVisitAt ?? '9999';
    return av.localeCompare(bv) || a.clientName.localeCompare(b.clientName);
  });
  return { clients, counts };
}

/** Per-client item keys to put in a bulk-sent packet (itemKey = key or key:purposeTag). */
export function bulkItemKeys(rows: ComplianceRow[], clientId: string): Set<string> {
  return new Set(rows.filter((r) => r.clientId === clientId && r.required && isBulkSendable(r)).map((r) => r.itemKey));
}

// ─── Reporting (completion rate by location / clinician) ─────────────────────

export type CompletionGroup = { key: string; label: string; required: number; complete: number; expiring: number; missing: number; expired: number; revoked: number; rate: number | null; clients: number };

/** Completion rate of required consents by a facet (location / clinician); complete includes expiring (still valid). */
export function completionBy(rows: ComplianceRow[], facets: Map<string, WorklistFacets>, by: 'location' | 'clinician'): CompletionGroup[] {
  const groups = new Map<string, CompletionGroup & { clientSet: Set<string> }>();
  for (const r of rows) {
    if (!r.required) continue;
    const f = facets.get(r.clientId);
    const key = (by === 'location' ? f?.locationId : f?.clinicianId) ?? 'none';
    const label = (by === 'location' ? f?.locationName : f?.clinicianName) ?? (by === 'location' ? 'No location' : 'No assigned clinician');
    let g = groups.get(key);
    if (!g) {
      g = { key, label, required: 0, complete: 0, expiring: 0, missing: 0, expired: 0, revoked: 0, rate: null, clients: 0, clientSet: new Set() };
      groups.set(key, g);
    }
    g.required += 1;
    g[r.standard] += 1;
    g.clientSet.add(r.clientId);
  }
  return [...groups.values()]
    .map(({ clientSet, ...g }) => ({ ...g, clients: clientSet.size, rate: g.required ? Math.round(((g.complete + g.expiring) / g.required) * 1000) / 10 : null }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
