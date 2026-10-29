/**
 * Valant client re-import, "facility only" mode: sets Client.valantFacility from the export's assigned
 * facility column and changes nothing else. Pure: no prisma. Idempotent: the same file twice writes once.
 * A blank cell never clears a stored value. A source id matching several clients is skipped (ambiguous).
 */
import { normalizeValantFacility } from './validate';

/** sourcePlatform values the Valant client imports have used (UI import: 'valant'; scripts: 'VALANT_EXPORT') */
export const VALANT_SOURCE_PLATFORMS = ['valant', 'VALANT_EXPORT', 'Valant'] as const;

export type FacilityRow = { row: number; sourceId: string | null; valantFacility: string | null };
export type ExistingFacilityClient = { id: string; sourceId: string | null; valantFacility: string | null };

export type ClientFacilityPlan = {
  updates: { clientId: string; from: string | null; to: string }[];
  unchanged: number;
  notFound: { row: number; sourceId: string }[];
  noFacility: number;
  noSourceId: number;
  ambiguous: { row: number; sourceId: string; clients: number }[];
};

export function planClientFacilityUpdates(rows: readonly FacilityRow[], existing: readonly ExistingFacilityClient[]): ClientFacilityPlan {
  const bySource = new Map<string, ExistingFacilityClient[]>();
  for (const c of existing) {
    const k = c.sourceId?.trim();
    if (!k) continue;
    const arr = bySource.get(k) ?? [];
    arr.push(c);
    bySource.set(k, arr);
  }
  const plan: ClientFacilityPlan = { updates: [], unchanged: 0, notFound: [], noFacility: 0, noSourceId: 0, ambiguous: [] };
  const planned = new Map<string, string>();
  for (const r of rows) {
    const sid = r.sourceId?.trim();
    if (!sid) {
      plan.noSourceId += 1;
      continue;
    }
    const value = normalizeValantFacility(r.valantFacility);
    if (!value) {
      plan.noFacility += 1;
      continue;
    }
    const hits = bySource.get(sid) ?? [];
    if (hits.length === 0) {
      plan.notFound.push({ row: r.row, sourceId: sid });
      continue;
    }
    if (hits.length > 1) {
      plan.ambiguous.push({ row: r.row, sourceId: sid, clients: hits.length });
      continue;
    }
    const c = hits[0];
    const current = planned.get(c.id) ?? c.valantFacility ?? null;
    if (current === value) {
      plan.unchanged += 1;
      continue;
    }
    if (planned.has(c.id)) {
      const u = plan.updates.find((x) => x.clientId === c.id)!;
      u.to = value;
    } else {
      plan.updates.push({ clientId: c.id, from: c.valantFacility ?? null, to: value });
    }
    planned.set(c.id, value);
  }
  return plan;
}
