/**
 * Roster lookups for patient matching: only the clients that could match a document (same source
 * ID / MRN, or same date of birth), never the whole roster.
 */
import { prisma } from '@/lib/db/prisma';
import type { ExtractedIdentifiers, RosterClient } from './patientMatcher';

const ROSTER_SELECT = {
  id: true, name: true, legalFirstName: true, legalLastName: true, dateOfBirth: true, mrn: true, sourceId: true,
} as const;

type RosterRow = {
  id: string; name: string | null; legalFirstName: string | null; legalLastName: string | null;
  dateOfBirth: Date | null; mrn: string | null; sourceId: string | null;
};

function toRoster(c: RosterRow): RosterClient {
  const parts = (c.name || '').trim().split(/\s+/);
  return {
    clientId: c.id,
    firstName: c.legalFirstName || parts[0] || '',
    lastName: c.legalLastName || parts.slice(1).join(' ') || '',
    dob: c.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : '',
    mrn: c.mrn ?? undefined,
    sourceId: c.sourceId ?? undefined,
  };
}

const dayRange = (dob: string) => {
  const day = new Date(`${dob}T00:00:00.000Z`);
  return { gte: day, lt: new Date(day.getTime() + 86_400_000) };
};

/** Only the clients that could match: same source id / MRN, or same date of birth */
export async function loadRoster(organizationId: string, sourceIds: string[], dob?: string): Promise<RosterClient[]> {
  const ids = sourceIds.map((s) => s.toUpperCase()).filter(Boolean);
  const or: Array<Record<string, unknown>> = [];
  if (ids.length) {
    or.push({ sourceId: { in: ids } });
    or.push({ mrn: { in: ids } });
  }
  if (dob) or.push({ dateOfBirth: dayRange(dob) });
  if (!or.length) return [];
  const rows = await prisma.client.findMany({ where: { organizationId, OR: or }, select: ROSTER_SELECT, take: 200 });
  return rows.map(toRoster);
}

/**
 * The roster for many pages at once (a document can have 100+ pages): a few batched queries,
 * then each page gets the same subset loadRoster would have returned for it alone.
 */
export async function loadRosterForPages(
  organizationId: string,
  pageIds: ExtractedIdentifiers[]
): Promise<RosterClient[][]> {
  const allIds = [...new Set(pageIds.flatMap((p) => p.sourceIds.map((s) => s.toUpperCase()).filter(Boolean)))];
  const allDobs = [...new Set(pageIds.map((p) => p.dob).filter((d): d is string => Boolean(d)))];

  const byId = new Map<string, RosterRow>();
  for (let i = 0; i < allIds.length; i += 500) {
    const chunk = allIds.slice(i, i + 500);
    const rows = await prisma.client.findMany({
      where: { organizationId, OR: [{ sourceId: { in: chunk } }, { mrn: { in: chunk } }] },
      select: ROSTER_SELECT,
      take: 2000,
    });
    for (const r of rows) byId.set(r.id, r);
  }
  for (let i = 0; i < allDobs.length; i += 50) {
    const chunk = allDobs.slice(i, i + 50);
    const rows = await prisma.client.findMany({
      where: { organizationId, OR: chunk.map((d) => ({ dateOfBirth: dayRange(d) })) },
      select: ROSTER_SELECT,
      take: 5000,
    });
    for (const r of rows) byId.set(r.id, r);
  }

  const roster = [...byId.values()].map((r) => ({ row: r, client: toRoster(r) }));
  return pageIds.map((ids) => {
    const wanted = new Set(ids.sourceIds.map((s) => s.toUpperCase()).filter(Boolean));
    return roster
      .filter(({ row, client }) =>
        (row.sourceId !== null && wanted.has(row.sourceId)) ||
        (row.mrn !== null && wanted.has(row.mrn)) ||
        (Boolean(ids.dob) && client.dob === ids.dob))
      .map(({ client }) => client);
  });
}
