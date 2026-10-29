/**
 * Consents worklist (server): loads required consents for every client the actor may see (org +
 * caseload scoping via clientAccessWhere), the client facets (location, clinician, programs, next
 * visit) and open packets, then filters / groups with worklistCore. Bulk "send packet" sends each
 * client ONLY the consents they still need (or reminds them about a packet already out).
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { practiceToday } from '@/lib/time/practiceTime';
import type { ComplianceRow } from './status';
import type { ComposeResult, PacketClientContext } from './composer';
import { createPacketForItems, loadComplianceData, type ContextClient, type LibraryActor } from './store';
import { notifyPacket, type NotifyChannel, type NotifyResult } from './delivery';
import { bulkItemKeys, buildWorklist, type WorklistFacets, type WorklistFilters, type WorklistProgram } from './worklistCore';

function programsOf(ctx: PacketClientContext | undefined): WorklistProgram[] {
  if (!ctx) return [];
  const out = new Set<WorklistProgram>();
  for (const s of ctx.services) {
    if (s === 'omhc' || s === 'group' || s === 'medication') out.add('omhc');
    else if (s === 'sud' || s === 'prp' || s === 'primary_care' || s === 'telehealth') out.add(s);
  }
  if (ctx.signals?.aot) out.add('aot');
  if (ctx.ageYears !== null && ctx.ageYears < 18) out.add('minor');
  return [...out];
}

export type WorklistData = {
  rows: ComplianceRow[];
  facets: Map<string, WorklistFacets>;
  openPackets: Map<string, string>;
  /** Required by a rule but no Active template: key → {title, clients} */
  unavailable: { key: string; title: string; clients: number }[];
  timeZone: string;
  required: Map<string, ComposeResult>;
  hiddenSensitiveClients: number;
};

/** Location, clinician (assigned, else next visit's), programs and next visit per client. */
export async function facetsFor(organizationId: string, clients: ContextClient[], contexts: Map<string, PacketClientContext>, tz: string, now: Date): Promise<Map<string, WorklistFacets>> {
  const ids = clients.map((c) => c.id);
  const locIds = [...new Set(clients.map((c) => c.locationId).filter((x): x is string => Boolean(x)))];
  const [locations, visits] = await Promise.all([
    locIds.length ? prisma.location.findMany({ where: { organizationId, id: { in: locIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ids.length
      ? prisma.appointment.findMany({
          where: { organizationId, clientId: { in: ids }, startsAt: { gte: now }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
          select: { clientId: true, startsAt: true, clinicianId: true },
          orderBy: { startsAt: 'asc' },
          distinct: ['clientId'],
        })
      : Promise.resolve([]),
  ]);
  const visitBy = new Map(visits.map((v) => [v.clientId, v]));
  const userIds = [...new Set([...clients.map((c) => c.assignedToId), ...visits.map((v) => v.clinicianId)].filter((x): x is string => Boolean(x)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const facets = new Map<string, WorklistFacets>();
  for (const c of clients) {
    const v = visitBy.get(c.id);
    const clinicianId = c.assignedToId ?? v?.clinicianId ?? null;
    facets.set(c.id, {
      locationId: c.locationId ?? null,
      locationName: c.locationId ? locName.get(c.locationId) ?? null : null,
      clinicianId,
      clinicianName: clinicianId ? userName.get(clinicianId) ?? null : null,
      programs: programsOf(contexts.get(c.id)),
      nextVisit: v ? practiceToday(tz, v.startsAt) : null,
      nextVisitAt: v?.startsAt.toISOString() ?? null,
    });
  }
  return facets;
}

export async function loadWorklistData(actor: LibraryActor, opts: { clientIds?: string[]; now?: Date } = {}): Promise<WorklistData> {
  const now = opts.now ?? new Date();
  const scope = clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role }) as Prisma.ClientWhereInput;
  const [all, tz] = await Promise.all([loadComplianceData(scope, actor.organizationId, { now, clientIds: opts.clientIds }), getPracticeTimeZone(actor.organizationId)]);
  // 42 CFR Part 2 / sensitive charts the actor cannot open are left out (counted, never named)
  const locked = all.clients.length ? await lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientIds: all.clients.map((c) => c.id) }) : new Set<string>();
  const data = locked.size
    ? { ...all, clients: all.clients.filter((c) => !locked.has(c.id)), rows: all.rows.filter((r) => !locked.has(r.clientId)), required: new Map([...all.required].filter(([id]) => !locked.has(id))) }
    : all;
  const ids = data.clients.map((c) => c.id);
  const [facets, packets] = await Promise.all([
    facetsFor(actor.organizationId, data.clients, data.contexts, tz, now),
    ids.length ? prisma.consentPacket.findMany({ where: { organizationId: actor.organizationId, clientId: { in: ids }, status: 'SENT', method: 'portal' }, select: { id: true, clientId: true }, orderBy: { sentAt: 'desc' } }) : Promise.resolve([]),
  ]);
  const openPackets = new Map<string, string>();
  for (const p of packets) if (!openPackets.has(p.clientId)) openPackets.set(p.clientId, p.id);
  const unavailable = new Map<string, { key: string; title: string; clients: number }>();
  for (const comp of data.required.values()) {
    for (const u of comp.requiredUnavailable ?? []) {
      const e = unavailable.get(u.key) ?? { key: u.key, title: u.title, clients: 0 };
      e.clients += 1;
      unavailable.set(u.key, e);
    }
  }
  return { rows: data.rows, facets, openPackets, unavailable: [...unavailable.values()].sort((a, b) => b.clients - a.clients), timeZone: tz, required: data.required, hiddenSensitiveClients: locked.size };
}

export async function loadWorklist(actor: LibraryActor, filters: WorklistFilters) {
  const d = await loadWorklistData(actor);
  const built = buildWorklist(d.rows, d.facets, filters, d.openPackets);
  const locations = new Map<string, string>();
  const clinicians = new Map<string, string>();
  for (const f of d.facets.values()) {
    if (f.locationId) locations.set(f.locationId, f.locationName ?? f.locationId);
    if (f.clinicianId) clinicians.set(f.clinicianId, f.clinicianName ?? 'Clinician');
  }
  const templates = new Map<string, string>();
  for (const r of d.rows) if (r.required) templates.set(r.templateKey, r.title);
  return {
    ...built,
    unavailable: d.unavailable,
    timeZone: d.timeZone,
    hiddenSensitiveClients: d.hiddenSensitiveClients,
    options: {
      locations: [...locations].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      clinicians: [...clinicians].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      templates: [...templates].map(([key, title]) => ({ key, title })).sort((a, b) => a.title.localeCompare(b.title)),
    },
  };
}

export type BulkSendOutcome = { clientId: string; outcome: 'sent' | 'reminded' | 'nothing_to_send' | 'not_found' | 'failed'; packetId: string | null; items: number; notify: NotifyResult[]; message: string };

/**
 * Bulk send from the worklist: per client, a portal packet with only the consents they still need
 * (missing / expired / expiring / new version), or a reminder for the packet already out.
 */
export async function bulkSendPackets(actor: LibraryActor, clientIds: string[], channels: NotifyChannel[]): Promise<BulkSendOutcome[]> {
  const unique = [...new Set(clientIds)].slice(0, 200);
  const d = await loadWorklistData(actor, { clientIds: unique });
  const out: BulkSendOutcome[] = [];
  for (const clientId of unique) {
    const required = d.required.get(clientId);
    if (!required) {
      out.push({ clientId, outcome: 'not_found', packetId: null, items: 0, notify: [], message: 'Client not found or not in your caseload.' });
      continue;
    }
    try {
      const open = d.openPackets.get(clientId);
      if (open) {
        const n = await notifyPacket({ organizationId: actor.organizationId, packetId: open, channels, actor: { userId: actor.userId, role: actor.role } });
        out.push({ clientId, outcome: 'reminded', packetId: open, items: 0, notify: n.ok === true ? n.results : [], message: n.ok === true ? 'A packet was already waiting; the client was reminded.' : n.error });
        continue;
      }
      const keys = bulkItemKeys(d.rows, clientId);
      const items = required.items.filter((i) => keys.has(i.purposeTag ? `${i.key}:${i.purposeTag}` : i.key)).map((i) => ({ ...i, optional: i.signing === 'standalone' }));
      if (!items.length) {
        out.push({ clientId, outcome: 'nothing_to_send', packetId: null, items: 0, notify: [], message: 'Nothing the client can sign from a packet (staff prepare the remaining forms, or the client revoked / declined them).' });
        continue;
      }
      const packetId = await createPacketForItems(actor, clientId, items, { ...required, items }, 'portal');
      const n = await notifyPacket({ organizationId: actor.organizationId, packetId, channels, actor: { userId: actor.userId, role: actor.role } });
      out.push({ clientId, outcome: 'sent', packetId, items: items.length, notify: n.ok ? n.results : [], message: `Sent ${items.length} form${items.length === 1 ? '' : 's'}.` });
    } catch {
      out.push({ clientId, outcome: 'failed', packetId: null, items: 0, notify: [], message: 'Could not send.' });
    }
  }
  return out;
}
