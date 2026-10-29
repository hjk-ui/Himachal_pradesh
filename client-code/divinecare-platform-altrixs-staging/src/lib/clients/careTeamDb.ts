/**
 * Prisma side of the care team "Seen by" list (rules in careTeam.ts). Server only.
 *
 * loadSeenByRows: one grouped query per source for a whole page of clients (no N+1):
 *   - Appointment: status COMPLETED (any source, incl. imported Valant history), clinicianId set,
 *     startsAt within the last SEEN_BY_WINDOW_MONTHS and not in the future -> max(startsAt)
 *   - MedicalVisit: providerId set, visitDate in the same window -> max(visitDate)
 * Grouped by (clientId, provider). The caller has already org-scoped and unlocked the client ids;
 * provider names / roles / status come from a staff lookup scoped to the organization.
 */
import { prisma } from '@/lib/db/prisma';
import { seenByWindowStart, type CareTeamSeenRow, type CareTeamStaffRef } from '@/lib/clients/careTeam';

export async function loadSeenByRows(clientIds: readonly string[], now: Date = new Date()): Promise<CareTeamSeenRow[]> {
  const ids = [...new Set(clientIds)];
  if (!ids.length) return [];
  const since = seenByWindowStart(now);
  const [appts, visits] = await Promise.all([
    prisma.appointment.groupBy({
      by: ['clientId', 'clinicianId'],
      where: { clientId: { in: ids }, status: 'COMPLETED', clinicianId: { not: null }, startsAt: { gte: since, lte: now } },
      _max: { startsAt: true },
    }),
    prisma.medicalVisit.groupBy({
      by: ['clientId', 'providerId'],
      where: { clientId: { in: ids }, providerId: { not: null }, visitDate: { gte: since, lte: now } },
      _max: { visitDate: true },
    }),
  ]);
  const out: CareTeamSeenRow[] = [];
  for (const a of appts) if (a.clinicianId && a._max.startsAt) out.push({ clientId: a.clientId, providerId: a.clinicianId, lastSeen: a._max.startsAt });
  for (const v of visits) if (v.providerId && v._max.visitDate) out.push({ clientId: v.clientId, providerId: v.providerId, lastSeen: v._max.visitDate });
  return out;
}

/** Staff refs (name, role, roles, status) for team + seen-by provider ids, scoped to the organization */
export async function loadCareTeamStaff(organizationId: string, userIds: readonly (string | null | undefined)[]): Promise<CareTeamStaffRef[]> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return [];
  const users = await prisma.user.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, name: true, role: true, roles: true, status: true },
  });
  return users.map((u) => ({ id: u.id, name: u.name, role: String(u.role), roles: (u.roles ?? []).map(String), status: String(u.status) }));
}
