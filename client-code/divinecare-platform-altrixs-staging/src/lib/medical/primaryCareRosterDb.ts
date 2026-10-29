/**
 * Prisma source for the Primary care patients roster (see primaryCareRoster.ts). Server only.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { DUE_SOON_DAYS } from '@/lib/labs/standing';
import { primaryCareLocationWhere } from '@/lib/medical/medicalProgram';
import type { LabSignal, RosterClientRow, RosterSource, RosterViewer } from '@/lib/medical/primaryCareRoster';
import { PCP_TEAM_ROLE, pcpReviewDisplay, type PcpDecision, type PcpReviewDisplay, type PcpStatus } from '@/lib/medical/pcpAssignment';
import { loadPcpContext, loadPcpDecisions, type PcpContext } from '@/lib/medical/pcpAssignmentDb';

const PROVIDER_ROLES: Role[] = ['PHYSICIAN', 'MEDICAL_NP'];

export function prismaRosterSource(viewer: RosterViewer): RosterSource {
  let pcpCtx: Promise<PcpContext> | null = null;
  const decisionCache = new Map<string, PcpDecision>();
  return {
    async primaryCareLocations(organizationId) {
      const rows = await prisma.location.findMany({
        where: { AND: [{ organizationId }, primaryCareLocationWhere()] },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      return rows;
    },

    async providers(organizationId) {
      const rows = await prisma.user.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          OR: [{ role: { in: PROVIDER_ROLES } }, { roles: { hasSome: PROVIDER_ROLES } }],
        },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
        take: 200,
      });
      return rows.map((u) => ({ id: u.id, name: u.name?.trim() || u.email || 'Provider' }));
    },

    count(where) {
      return prisma.client.count({ where });
    },

    async page(where: Prisma.ClientWhereInput, skip, take, now): Promise<RosterClientRow[]> {
      const rows = await prisma.client.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          name: true,
          mrn: true,
          dateOfBirth: true,
          gender: true,
          status: true,
          location: { select: { name: true } },
          treatmentTeamMembers: {
            select: { providerId: true, name: true, credentials: true, isPrimary: true, role: true },
            orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'asc' }],
          },
          medicalVisits: {
            orderBy: { visitDate: 'desc' },
            take: 1,
            select: { visitDate: true, visitType: true, providerId: true, providerName: true, provider: { select: { name: true } } },
          },
          medicalVitals: { orderBy: { recordedAt: 'desc' }, take: 1, select: { recordedAt: true } },
          medicalProblems: { select: { icd10Code: true, status: true } },
          appointments: {
            where: { status: 'SCHEDULED', startsAt: { gte: now } },
            orderBy: { startsAt: 'asc' },
            take: 1,
            select: { startsAt: true, type: true, clinicianName: true, clinician: { select: { name: true } } },
          },
        },
      });
      // Legacy PCP text on the linked MedicalPatient rows (one patient record: bhClientId or same MRN)
      const ids = rows.map((c) => c.id);
      const mrns = rows.map((c) => c.mrn).filter((m): m is string => Boolean(m));
      const shadows = ids.length
        ? await prisma.medicalPatient.findMany({
            where: { organizationId: viewer.organizationId, OR: [{ bhClientId: { in: ids } }, ...(mrns.length ? [{ mrn: { in: mrns } }] : [])] },
            select: { bhClientId: true, mrn: true, assignedPcp: true },
          })
        : [];
      return rows.map((c) => {
        const v = c.medicalVisits[0];
        const pcpText = shadows.find((m) => (m.bhClientId === c.id || (c.mrn && m.mrn === c.mrn)) && m.assignedPcp.trim())?.assignedPcp ?? null;
        const a = c.appointments[0];
        return {
          id: c.id,
          name: c.name,
          mrn: c.mrn,
          dateOfBirth: c.dateOfBirth,
          gender: c.gender,
          status: c.status,
          locationName: c.location?.name ?? null,
          team: c.treatmentTeamMembers,
          assignedPcpText: pcpText,
          lastVisit: v
            ? { visitDate: v.visitDate, visitType: v.visitType, providerId: v.providerId, providerName: v.providerName, providerUserName: v.provider?.name ?? null }
            : null,
          lastVitalsAt: c.medicalVitals[0]?.recordedAt ?? null,
          problems: c.medicalProblems,
          nextAppointment: a ? { startsAt: a.startsAt, type: a.type, clinicianName: a.clinician?.name || a.clinicianName || null } : null,
        };
      });
    },

    async pcpStatuses(organizationId, clientIds, now) {
      const out = new Map<string, PcpStatus>();
      if (!clientIds.length) return out;
      try {
        pcpCtx ??= loadPcpContext(organizationId);
        const decisions = await loadPcpDecisions(await pcpCtx, clientIds, now);
        for (const [id, d] of decisions) {
          out.set(id, d.decision.status);
          decisionCache.set(id, d.decision);
        }
      } catch (err) {
        // ValantProviderMap may not be migrated yet on every environment: no status, roster still loads
        console.error('[medical roster] PCP status lookup failed', err instanceof Error ? err.name : 'error');
      }
      return out;
    },

    // Reuses the decisions pcpStatuses just loaded for this request (no second evidence query)
    async pcpReviews(organizationId, clientIds, now) {
      const out = new Map<string, PcpReviewDisplay>();
      if (!clientIds.length) return out;
      const missing = clientIds.filter((id) => !decisionCache.has(id));
      if (missing.length) await this.pcpStatuses!(organizationId, missing, now);
      if (!pcpCtx) return out;
      const ctx = await pcpCtx;
      for (const id of clientIds) {
        const d = decisionCache.get(id);
        const review = d ? pcpReviewDisplay(d, ctx.staff) : null;
        if (review) out.set(id, review);
      }
      return out;
    },

    async sortRows(where, max) {
      const rows = await prisma.client.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: max,
        select: {
          id: true,
          name: true,
          treatmentTeamMembers: {
            where: { role: { equals: PCP_TEAM_ROLE, mode: 'insensitive' }, providerId: { not: null } },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: 1,
            select: { name: true },
          },
        },
      });
      return rows.map((r) => ({ id: r.id, name: r.name, pcpName: r.treatmentTeamMembers[0]?.name ?? null }));
    },

    async userRoles(organizationId, userIds) {
      if (!userIds.length) return new Map();
      const rows = await prisma.user.findMany({
        where: { organizationId, id: { in: userIds } },
        select: { id: true, role: true },
      });
      return new Map(rows.map((u) => [u.id, u.role as string]));
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
        console.error('[medical roster] sensitive record lookup failed; masking all rows', err instanceof Error ? err.name : 'error');
        return null;
      }
    },

    async labSignals(organizationId, clientIds, now) {
      const out = new Map<string, LabSignal>();
      const get = (id: string) => {
        let s = out.get(id);
        if (!s) out.set(id, (s = { unreviewed: 0, critical: 0, standingDue: 0, standingOverdue: 0 }));
        return s;
      };
      const soon = new Date(now.getTime() + DUE_SOON_DAYS * 86_400_000);
      const [orders, standing] = await Promise.all([
        prisma.labOrder.groupBy({
          by: ['clientId', 'status'],
          where: { organizationId, clientId: { in: clientIds }, status: { in: ['resulted', 'critical'] }, reviewedAt: null },
          _count: { _all: true },
        }),
        prisma.labStandingOrder
          .findMany({
            where: {
              organizationId,
              clientId: { in: clientIds },
              active: true,
              nextDueAt: { lte: soon },
              OR: [{ endDate: null }, { endDate: { gte: now } }],
            },
            select: { clientId: true, nextDueAt: true },
          })
          .catch((err: unknown) => {
            // Standing orders table may not be migrated yet on every environment
            console.error('[medical roster] standing orders lookup failed', err instanceof Error ? err.name : 'error');
            return [] as { clientId: string; nextDueAt: Date }[];
          }),
      ]);
      for (const o of orders) {
        const s = get(o.clientId);
        s.unreviewed += o._count._all;
        if (o.status === 'critical') s.critical += o._count._all;
      }
      for (const st of standing) {
        const s = get(st.clientId);
        if (st.nextDueAt < now) s.standingOverdue += 1;
        else s.standingDue += 1;
      }
      return out;
    },
  };
}
