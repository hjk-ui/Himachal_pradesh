import { prisma } from '@/lib/db/prisma';
import { proxyMayView, type PortalActor, type PortalItemCategory } from '@/patient/domain/proxy-policy';

/**
 * Portal item filtering for proxies (guardian / representative logins).
 * The client's own login is never filtered and never queries the overrides table.
 */

export type PortalItemType =
  | 'treatment_plan'
  | 'consent_packet'
  | 'carelon_attestation'
  | 'consent_form'
  | 'resource'
  | 'appointment'
  | 'message_thread';

export const PORTAL_ITEM_TYPES: readonly PortalItemType[] = [
  'treatment_plan',
  'consent_packet',
  'carelon_attestation',
  'consent_form',
  'resource',
  'appointment',
  'message_thread',
];

type Scope = { clientId: string; access?: PortalActor | null };

type Override = 'confidential' | 'shared_with_guardian';

/** Clinician overrides for these items (confidential / shared with guardian). */
export async function loadOverrides(clientId: string, itemType: PortalItemType, ids: string[]): Promise<Map<string, Override>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.portalItemVisibility.findMany({
    where: { clientId, itemType, itemId: { in: ids.slice(0, 500) } },
    select: { itemId: true, visibility: true },
  });
  return new Map(rows.map((r) => [r.itemId, r.visibility === 'confidential' ? 'confidential' : 'shared_with_guardian'] as const));
}

/**
 * Keeps the items the signed-in person may see. `facts` describes each item (Part 2, category).
 * Unchanged for the client's own login.
 */
export async function filterForProxy<T>(
  scope: Scope,
  itemType: PortalItemType | ((item: T) => PortalItemType),
  items: T[],
  facts: (item: T) => { id: string; part2?: boolean; category?: PortalItemCategory }
): Promise<T[]> {
  const actor = scope.access;
  if (!actor?.isProxy || items.length === 0) return items;
  const typeOf = typeof itemType === 'function' ? itemType : () => itemType;
  const byType = new Map<PortalItemType, string[]>();
  for (const item of items) {
    const t = typeOf(item);
    byType.set(t, [...(byType.get(t) ?? []), facts(item).id]);
  }
  const overrides = new Map<string, Override>();
  for (const [t, ids] of byType) {
    for (const [id, v] of await loadOverrides(scope.clientId, t, ids)) overrides.set(`${t}:${id}`, v);
  }
  return items.filter((item) => {
    const f = facts(item);
    return proxyMayView(actor, { part2: f.part2, category: f.category, override: overrides.get(`${typeOf(item)}:${f.id}`) ?? null });
  });
}

/** One item: true when the signed-in person may see it. */
export async function mayViewItem(
  scope: Scope,
  itemType: PortalItemType,
  item: { id: string; part2?: boolean; category?: PortalItemCategory }
): Promise<boolean> {
  return (await filterForProxy(scope, itemType, [item], (x) => x)).length === 1;
}

/**
 * Part 2 test for consent forms by type / form key: a 42 CFR Part 2 consent or SUD record. The Part 2
 * confidentiality notice every client acknowledges is not SUD content and stays visible.
 */
export function looksPart2(text: string | null | undefined): boolean {
  if (!text) return false;
  if (/notice/i.test(text)) return false;
  return /part[\s-]?2|42\s*cfr|substance\s+use|\bsud\b/i.test(text);
}

// ─── Documents to sign (treatment plans, Carelon attestation, consent packets) ───────────────

type PortalDoc = { id: string; kind: string };

function docItemType(d: PortalDoc): PortalItemType {
  return d.kind === 'treatment-plan' ? 'treatment_plan' : d.kind === 'carelon-attestation' ? 'carelon_attestation' : 'consent_packet';
}

/** Consent packets that contain a 42 CFR Part 2 section: only the minor / patient controls those. */
async function part2PacketIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.consentPacket.findMany({ where: { id: { in: ids.slice(0, 200) } }, select: { id: true, items: true } });
  // Only the Part 2 consent itself (the Part 2 confidentiality notice is in every packet and is not SUD content)
  return new Set(rows.filter((r) => /"part2-consent"/.test(JSON.stringify(r.items ?? null))).map((r) => r.id));
}

/**
 * Documents a proxy may see: treatment plans are mental health records (hidden from a limited proxy
 * when the minor consented to their own care), consent packets with a Part 2 section are hidden, and
 * clinician overrides apply. The client's own login sees everything (no queries).
 */
export async function filterPortalDocuments<T extends PortalDoc>(scope: Scope, docs: T[]): Promise<T[]> {
  if (!scope.access?.isProxy || docs.length === 0) return docs;
  const part2 = await part2PacketIds(docs.filter((d) => d.kind === 'consent-packet').map((d) => d.id));
  return filterForProxy(scope, (d: T) => docItemType(d), docs, (d) => ({
    id: d.id,
    part2: d.kind === 'consent-packet' && part2.has(d.id),
    category: d.kind === 'treatment-plan' ? 'mental_health' : 'administrative',
  }));
}

// ─── Resources sent to the portal ─────────────────────────────────────────────────────────────

/** Resources: Part 2 = the assignment's Part 2 flag or SUD library content. */
export async function filterPortalResources<T extends { id: string }>(scope: Scope, rows: T[]): Promise<T[]> {
  if (!scope.access?.isProxy || rows.length === 0) return rows;
  const meta = await prisma.resourceAssignment.findMany({
    where: { id: { in: rows.map((r) => r.id).slice(0, 500) }, clientId: scope.clientId },
    select: { id: true, part2: true, item: { select: { sudRelated: true } } },
  });
  const part2 = new Set(meta.filter((m) => m.part2 || m.item?.sudRelated).map((m) => m.id));
  return filterForProxy(scope, 'resource', rows, (r) => ({ id: r.id, part2: part2.has(r.id), category: 'general' }));
}

/** One resource assignment id: may this proxy open it? (checked BEFORE opening marks it viewed) */
export async function proxyMayOpenResource(scope: Scope, id: string): Promise<boolean> {
  if (!scope.access?.isProxy) return true;
  return (await filterPortalResources(scope, [{ id }])).length === 1;
}
