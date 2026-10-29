/**
 * Seen-by (Oct 25): providers who completed a visit with each client in the last 18 months.
 * Sources: COMPLETED appointments (incl. imported Valant history) and COMPLETED medical visits.
 * Facts only — a provider appears because a completed visit says so, never by inference.
 */
import { prisma } from '@/lib/db/prisma';
import { SEEN_BY_MONTHS, type SeenByProvider } from './careTeamSummary';

export function seenByCutoff(now = new Date()): Date {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - SEEN_BY_MONTHS);
  return d;
}

type Row = {
  clientId: string;
  providerId: string | null;
  name: string | null;
  role: string | null;
  at: Date;
  source: SeenByProvider['source'];
};

/** Pure merge: one entry per (client, provider) with the most recent completed visit. */
export function mergeSeenBy(rows: Row[]): Map<string, SeenByProvider[]> {
  const byClient = new Map<string, Map<string, SeenByProvider>>();
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) continue;
    const key = row.providerId ?? `name:${name.toLowerCase()}`;
    const perClient = byClient.get(row.clientId) ?? new Map<string, SeenByProvider>();
    byClient.set(row.clientId, perClient);
    const at = row.at.toISOString();
    const existing = perClient.get(key);
    if (!existing) {
      perClient.set(key, { providerId: row.providerId, name, role: row.role, lastSeenAt: at, source: row.source });
      continue;
    }
    // Keep the newest date; a medical visit marks the provider as primary-care.
    if (at > existing.lastSeenAt) existing.lastSeenAt = at;
    if (row.source === 'medicalVisit') existing.source = 'medicalVisit';
    if (!existing.role && row.role) existing.role = row.role;
  }
  return new Map(
    [...byClient].map(([clientId, perClient]) => [
      clientId,
      [...perClient.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
    ])
  );
}

export async function loadSeenBy(
  clientIds: string[],
  now = new Date()
): Promise<Map<string, SeenByProvider[]>> {
  if (clientIds.length === 0) return new Map();
  const cutoff = seenByCutoff(now);

  const [appointments, medicalVisits] = await Promise.all([
    prisma.appointment.findMany({
      where: { clientId: { in: clientIds }, status: 'COMPLETED', startsAt: { gte: cutoff, lte: now } },
      orderBy: { startsAt: 'desc' },
      distinct: ['clientId', 'clinicianId', 'clinicianName'],
      select: {
        clientId: true,
        clinicianId: true,
        clinicianName: true,
        startsAt: true,
        clinician: { select: { name: true, role: true } },
      },
    }),
    prisma.medicalVisit.findMany({
      where: { clientId: { in: clientIds }, status: 'COMPLETED', visitDate: { gte: cutoff, lte: now } },
      orderBy: { visitDate: 'desc' },
      distinct: ['clientId', 'providerId', 'providerName'],
      select: {
        clientId: true,
        providerId: true,
        providerName: true,
        visitDate: true,
        provider: { select: { name: true, role: true } },
      },
    }),
  ]);

  return mergeSeenBy([
    ...appointments.map((a) => ({
      clientId: a.clientId,
      providerId: a.clinicianId,
      name: a.clinician?.name ?? a.clinicianName,
      role: a.clinician?.role ?? null,
      at: a.startsAt,
      source: 'appointment' as const,
    })),
    ...medicalVisits.map((v) => ({
      clientId: v.clientId,
      providerId: v.providerId,
      name: v.provider?.name ?? v.providerName,
      role: v.provider?.role ?? null,
      at: v.visitDate,
      source: 'medicalVisit' as const,
    })),
  ]);
}
