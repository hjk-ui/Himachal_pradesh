/**
 * Plan for scripts/backfill-module-client-ids.ts: link legacy per-client module items (saved with a
 * client NAME only, no clientId) to the client record, so the caseload scope in
 * src/lib/modules/clientScope.ts can show them to the treating clinicians again (unlinked items are
 * shown to org-wide roles only).
 *
 * Rules (nothing is guessed or invented):
 *   - only items with no clientId / patientId;
 *   - the item's name field (clientName / patientName / name) must equal exactly one client of the
 *     organization, case-insensitive, whitespace collapsed; zero or several matches -> left unlinked;
 *   - only clientId is added; nothing else in the item changes.
 * Pure (no database).
 */
import { CLIENT_SCOPED_MODULES } from './clientScope';

/** Modules whose legacy items carry a client name we can match (name field per module). */
export const NAME_LINK_MODULES: Record<string, readonly string[]> = {
  'ehr-safety-plans': ['clientName'],
  'ehr-discharge-cases': ['clientName'],
  'outcome-schedules': ['patientName'],
  'patient-surveys': ['patientName'],
  'ehr-overview-revals': ['name'],
  'sdoh-screenings': ['clientName', 'patientName'],
  'prp-participants': ['clientName', 'name'],
};

export function normalizePersonName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

export type ClientLinkCounts = {
  items: number;
  alreadyLinked: number;
  linked: number;
  noName: number;
  noMatch: number;
  ambiguous: number;
  notList: number;
};

export function emptyClientLinkCounts(): ClientLinkCounts {
  return { items: 0, alreadyLinked: 0, linked: 0, noName: 0, noMatch: 0, ambiguous: 0, notList: 0 };
}

/** name (normalized) -> client ids with that exact name */
export function clientNameIndex(clients: { id: string; name: string | null }[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const c of clients) {
    const key = normalizePersonName(c.name);
    if (!key) continue;
    index.set(key, [...(index.get(key) ?? []), c.id]);
  }
  return index;
}

export function planModuleClientLinks(
  module: string,
  data: unknown,
  nameIndex: Map<string, string[]>,
): { data: unknown; counts: ClientLinkCounts; changed: boolean } {
  const counts = emptyClientLinkCounts();
  const fields = NAME_LINK_MODULES[module];
  if (!fields || !CLIENT_SCOPED_MODULES[module]) return { data, counts, changed: false };
  if (!Array.isArray(data)) {
    counts.notList = data == null ? 0 : 1;
    return { data, counts, changed: false };
  }
  let changed = false;
  const next = data.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    counts.items++;
    const r = item as Record<string, unknown>;
    const hasLink = [r.clientId, r.patientId].some((v) => typeof v === 'string' && v.trim());
    // part2-clients style ids are not handled here (not in NAME_LINK_MODULES)
    if (hasLink) {
      counts.alreadyLinked++;
      return item;
    }
    const name = fields.map((f) => normalizePersonName(r[f])).find(Boolean) ?? '';
    if (!name) {
      counts.noName++;
      return item;
    }
    const matches = nameIndex.get(name) ?? [];
    if (matches.length === 0) {
      counts.noMatch++;
      return item;
    }
    if (matches.length > 1) {
      counts.ambiguous++;
      return item;
    }
    counts.linked++;
    changed = true;
    return { ...r, clientId: matches[0] };
  });
  return { data: changed ? next : data, counts, changed };
}
