/**
 * Prisma source for the primary care overview (see primaryCareOverview.ts). Server only.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import type { OverviewSource, OverviewViewer, TodayAppointmentRow } from '@/lib/medical/primaryCareOverview';

const tag = (err: unknown) => (err instanceof Error ? err.name : 'error');

export function prismaOverviewSource(viewer: OverviewViewer): OverviewSource {
  return {
    async todayAppointments(where, take): Promise<TodayAppointmentRow[]> {
      const rows = await prisma.appointment.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take,
        select: {
          id: true,
          clientId: true,
          startsAt: true,
          type: true,
          status: true,
          isVirtual: true,
          clinicianName: true,
          clinician: { select: { name: true } },
          client: { select: { name: true } },
        },
      });
      return rows.map((a) => ({
        id: a.id,
        clientId: a.clientId,
        clientName: a.client.name,
        startsAt: a.startsAt,
        type: a.type,
        status: a.status,
        isVirtual: a.isVirtual,
        clinicianName: a.clinician?.name?.trim() || a.clinicianName || null,
      }));
    },

    async lockedAliases(clientIds) {
      if (!clientIds.length) return new Map();
      try {
        const map = await resolveSensitiveAccessMap({
          organizationId: viewer.organizationId,
          userId: viewer.userId,
          role: viewer.role,
          clientIds,
        });
        const out = new Map<string, string | null>();
        for (const [id, info] of map) if (!info.canAccessSensitive) out.set(id, info.alias);
        return out;
      } catch (err) {
        console.error('[medical overview] sensitive record lookup failed; masking all rows', tag(err));
        return null;
      }
    },

    async vitalsRecorded(clientIds, start, end) {
      if (!clientIds.length) return new Set();
      const rows = await prisma.medicalVital.findMany({
        where: { clientId: { in: clientIds }, recordedAt: { gte: start, lt: end } },
        select: { clientId: true },
        distinct: ['clientId'],
      });
      return new Set(rows.map((r) => r.clientId));
    },

    countClients(where) {
      return prisma.client.count({ where });
    },

    async clientsByLocation(where) {
      const rows = await prisma.client.groupBy({ by: ['locationId'], where, _count: { _all: true } });
      return rows.map((r) => ({ locationId: r.locationId, count: r._count._all }));
    },

    async locationNames(organizationId, ids) {
      const rows = await prisma.location.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, name: true },
      });
      return new Map(rows.map((l) => [l.id, l.name]));
    },

    countVisits(where) {
      return prisma.medicalVisit.count({ where });
    },

    countProblems(where) {
      return prisma.medicalProblem.count({ where });
    },

    async labsAwaitingReview(organizationId, population) {
      const rows = await prisma.labOrder.groupBy({
        by: ['status'],
        where: { organizationId, client: population, status: { in: ['resulted', 'critical'] }, reviewedAt: null },
        _count: { _all: true },
      });
      let toReview = 0;
      let critical = 0;
      for (const r of rows) {
        toReview += r._count._all;
        if (r.status === 'critical') critical += r._count._all;
      }
      return { toReview, critical };
    },

    async standingOverdue(organizationId, population, now) {
      // LabStandingOrder has no client relation: find overdue orders, then keep the ones whose
      // client is in the viewer's population.
      let overdue: { clientId: string }[];
      try {
        overdue = await prisma.labStandingOrder.findMany({
          where: { organizationId, active: true, nextDueAt: { lt: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] },
          select: { clientId: true },
          take: 5000,
        });
      } catch (err) {
        // Standing orders table may not be migrated yet on every environment
        console.error('[medical overview] standing orders lookup failed', tag(err));
        return 0;
      }
      if (!overdue.length) return 0;
      const ids = [...new Set(overdue.map((o) => o.clientId))];
      const allowed = await prisma.client.findMany({
        where: { AND: [population, { id: { in: ids } }] } as Prisma.ClientWhereInput,
        select: { id: true },
      });
      const ok = new Set(allowed.map((c) => c.id));
      return overdue.filter((o) => ok.has(o.clientId)).length;
    },

    async roomings(appointmentIds) {
      if (!appointmentIds.length) return new Map();
      const rows = await prisma.medicalRooming.findMany({
        where: { organizationId: viewer.organizationId, appointmentId: { in: appointmentIds } },
        select: { appointmentId: true, status: true, roomedAt: true, inRoomAt: true },
      });
      return new Map(rows.map((r) => [r.appointmentId, { status: r.status, roomedAt: r.roomedAt, inRoomAt: r.inRoomAt }]));
    },

    async rxPending(v, access) {
      const me = await prisma.user.findUnique({ where: { id: v.userId }, select: { rcopiaUsername: true } });
      const username = me?.rcopiaUsername?.trim() || null;
      const [refills, rxChanges] = await Promise.all([
        username
          ? prisma.rcopiaRefillNotification.count({
              // Routed by the provider who owns the renewal in Rcopia (same rule as the inbox)
              where: { actionTaken: 'pending', providerUsername: { equals: username, mode: 'insensitive' }, client: clientOrgFilter(v.organizationId) },
            })
          : Promise.resolve(null),
        // RxChange rows carry no prescriber, so they are routed by care team / caseload
        prisma.rcopiaRxchangeRequest.count({ where: { status: 'pending', client: access } }),
      ]);
      return { refills, rxChanges };
    },
  };
}
