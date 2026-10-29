/**
 * Server-side loader for GET /api/reports/population. Reads one fact row per ACTIVE client in the
 * viewer's scope (populationClientWhere) with aggregate queries, then hands them to the pure
 * buildPopulationReport (populationHealth.ts). Nothing here reads the paged client list.
 */
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getModuleData } from '@/lib/modules/manage';
import { loadSessionFrequency } from '@/lib/clinical/sessionFrequencyData';
import { ATTENDED_APPOINTMENT_STATUSES, type SessionFrequencyItem } from '@/lib/clinical/sessionFrequency';
import { GAD7, PHQ9, reportClientWhere, type ReportScope } from '@/lib/reports/outcomesReports';
import { loadOptions } from '@/lib/reports/outcomesReportsQueries';
import {
  MBC_WINDOW_DAYS,
  PHQ9_SEVERE,
  buildPopulationReport,
  populationClientWhere,
  type PopulationClientFacts,
  type PopulationFilters,
  type PopulationReport,
} from '@/lib/reports/populationHealth';

const DAY_MS = 86_400_000;

/** Prisma returns `timestamp without time zone` (stored as UTC) as a Date; normalize to the UTC instant */
const utcInstant = (d: Date | string) => new Date(`${new Date(d).toISOString().slice(0, 23)}Z`);

/**
 * Last attended visit per client, all time: attended appointment (or SCHEDULED with a claim),
 * signed / locked progress note (date of service, else created), or a Valant charge line that
 * nets above zero. Same evidence as the Session Frequency alert, without the CPT restriction
 * (any service counts as a visit for engagement).
 */
export async function loadLastVisits(organizationId: string, ids: string[], now: Date): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const nowIso = now.toISOString();
  const attended = [...ATTENDED_APPOINTMENT_STATUSES];
  const rows = await prisma.$queryRaw<{ clientId: string; last: Date }[]>(Prisma.sql`
    WITH ev AS (
      SELECT ap."clientId", max(ap."startsAt") AS at
      FROM "Appointment" ap
      WHERE ap."clientId" = ANY(${ids}::text[]) AND ap."startsAt" <= ${nowIso}::timestamp
        AND (ap."status"::text = ANY(${attended}::text[])
             OR (ap."status"::text = 'SCHEDULED' AND EXISTS (SELECT 1 FROM "Claim" c WHERE c."appointmentId" = ap."id" AND c."cptCode" <> '')))
      GROUP BY ap."clientId"
      UNION ALL
      SELECT pn."clientId",
             max(CASE WHEN pn."dateOfService" IS NOT NULL THEN pn."dateOfService" + interval '12 hours' ELSE pn."createdAt" END)
      FROM "ProgressNote" pn
      JOIN "ProgressNoteWorkflow" w ON w."noteId" = pn."id" AND w."status"::text IN ('SIGNED', 'LOCKED')
      WHERE pn."clientId" = ANY(${ids}::text[])
        AND coalesce(pn."dateOfService", pn."createdAt") <= ${nowIso}::timestamp
      GROUP BY pn."clientId"
      UNION ALL
      SELECT v."clientId", max(v.day) + interval '12 hours'
      FROM (
        SELECT vt."clientId", vt."serviceDate" AS day
        FROM "ValantTransaction" vt
        WHERE vt."organizationId" = ${organizationId} AND vt."clientId" = ANY(${ids}::text[])
          AND vt."category" = 'charge' AND vt."serviceDate" <= ${nowIso}::timestamp
        GROUP BY vt."clientId", coalesce(vt."billingId", ''), vt."serviceDate", vt."codeBase"
        HAVING sum(vt."amountCents") > 0
      ) v
      GROUP BY v."clientId"
    )
    SELECT "clientId", max(at) AS last FROM ev GROUP BY "clientId"`);
  const map = new Map<string, Date>();
  for (const r of rows) {
    if (!r.last) continue;
    const at = utcInstant(r.last);
    // A date-only note / charge on today gets noon; never place a visit in the future
    map.set(r.clientId, at.getTime() > now.getTime() ? now : at);
  }
  return map;
}

/** A saved evaluation safety-plan section with at least one filled-in value */
export function hasFilledJson(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const walk = (v: unknown): boolean =>
      typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) ? v.some(walk) : v && typeof v === 'object' ? Object.values(v).some(walk) : false;
    return walk(JSON.parse(raw));
  } catch {
    return raw.trim().length > 0;
  }
}

/** Safety-plan module entries linked by clientId (name-only entries are not matched; counted) */
export function safetyPlanClientIds(data: unknown): { ids: Set<string>; unlinked: number } {
  const list = Array.isArray(data) ? data : [];
  const ids = new Set<string>();
  let unlinked = 0;
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const id = (r as { clientId?: unknown }).clientId;
    if (typeof id === 'string' && id) ids.add(id);
    else unlinked += 1;
  }
  return { ids, unlinked };
}

export async function buildPopulationHealth(
  scope: ReportScope,
  filters: PopulationFilters,
  now: Date
): Promise<PopulationReport> {
  const where = populationClientWhere(scope);
  const clients = await prisma.client.findMany({
    where,
    select: {
      id: true,
      name: true,
      mrn: true,
      riskLevel: true,
      assignedToId: true,
      assignedTo: { select: { name: true, email: true } },
      location: { select: { name: true } },
      createdAt: true,
      importedAt: true,
      sensitiveRecord: { select: { alias: true } },
    },
  });
  const ids = clients.map((c) => c.id);
  const org = scope.organizationId;
  const mbcStart = new Date(now.getTime() - MBC_WINDOW_DAYS * DAY_MS);
  const clientRel = { client: where };

  const [
    alertGroups, cssrsLatest, evals, measured, severe, nextAppts, lastVisits, planModule, options, hidden, cadence,
  ] = await Promise.all([
    prisma.riskAlert.groupBy({ by: ['clientId', 'severity', 'reviewed'], where: clientRel, _count: { _all: true } }),
    prisma.clinicalAssessmentRecord.findMany({
      where: { organizationId: org, ...clientRel, instrumentId: { startsWith: 'c-ssrs' } },
      orderBy: [{ clientId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['clientId'],
      select: { clientId: true, safetyFlagged: true },
    }),
    prisma.clinicalEvaluationRecord.findMany({
      where: { organizationId: org, ...clientRel, status: { in: ['FINALIZED', 'AMENDED'] } },
      select: { clientId: true, safetyPlanJson: true },
    }),
    prisma.clinicalAssessmentRecord.groupBy({
      by: ['clientId'],
      where: { organizationId: org, ...clientRel, instrumentId: { in: [PHQ9.id, GAD7.id] }, totalScore: { not: null }, createdAt: { gte: mbcStart, lte: now } },
      _count: { _all: true },
    }),
    prisma.clinicalAssessmentRecord.findMany({
      where: { organizationId: org, ...clientRel, instrumentId: PHQ9.id, totalScore: { gte: PHQ9_SEVERE } },
      select: { id: true, clientId: true, totalScore: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.appointment.groupBy({
      by: ['clientId'],
      where: { ...clientRel, status: 'SCHEDULED', startsAt: { gt: now } },
      _min: { startsAt: true },
    }),
    loadLastVisits(org, ids, now),
    getModuleData<unknown>(org, 'ehr-safety-plans').catch(() => null),
    loadOptions(org),
    scope.lockedClientIds.length
      ? prisma.client.count({
          where: { AND: [reportClientWhere({ ...scope, lockedClientIds: [] }, { byAssignee: true }), { status: 'ACTIVE' }, { id: { in: scope.lockedClientIds } }] },
        })
      : Promise.resolve(0),
    ids.length
      ? // The viewer's whole-scope session-frequency result (cached 60s and shared with the inbox and
        // role home). Its client set (access + ACTIVE + location) contains this report's clients,
        // which add only clinician and Part 2 filters, so the items are narrowed to `ids` here.
        loadSessionFrequency(
          { organizationId: org, actorUserId: scope.userId, actorRole: scope.role as Role },
          { locationId: scope.locationId ?? undefined },
          now
        )
          .then((r) => {
            const inReport = new Set(ids);
            return { ...r, items: r.items.filter((i) => inReport.has(i.clientId)) };
          })
          .catch((err) => {
          console.error('[population] session frequency unavailable', err instanceof Error ? err.name : 'unknown');
          return null;
        })
      : Promise.resolve({ items: [] as SessionFrequencyItem[] }),
  ]);

  const acks = severe.length
    ? await prisma.mbcAlertAck.findMany({ where: { organizationId: org, assessmentId: { in: severe.map((s) => s.id) } }, select: { assessmentId: true } })
    : [];
  const acked = new Set(acks.map((a) => a.assessmentId));

  const openSev = new Map<string, string[]>();
  const anyAlert = new Set<string>();
  for (const g of alertGroups) {
    anyAlert.add(g.clientId);
    if (!g.reviewed) {
      const list = openSev.get(g.clientId) ?? [];
      for (let i = 0; i < g._count._all; i++) list.push(g.severity);
      openSev.set(g.clientId, list);
    }
  }
  const cssrsBy = new Map(cssrsLatest.map((c) => [c.clientId, c.safetyFlagged]));
  const evaluated = new Set(evals.map((e) => e.clientId));
  const evalPlan = new Set(evals.filter((e) => hasFilledJson(e.safetyPlanJson)).map((e) => e.clientId));
  const plans = safetyPlanClientIds(planModule);
  const measuredSet = new Set(measured.map((m) => m.clientId));
  const severeBy = new Map<string, { score: number; at: Date }>();
  for (const s of severe) {
    if (acked.has(s.id) || severeBy.has(s.clientId)) continue;
    severeBy.set(s.clientId, { score: s.totalScore as number, at: s.createdAt });
  }
  const nextBy = new Map(nextAppts.map((n) => [n.clientId, n._min.startsAt]));
  const cadenceBy = new Map<string, SessionFrequencyItem>((cadence?.items ?? []).map((i: SessionFrequencyItem) => [i.clientId, i] as const));
  const cadenceAvailable = cadence !== null;

  const facts: PopulationClientFacts[] = clients.map((c) => {
    const cad = cadenceBy.get(c.id);
    return {
      id: c.id,
      name: c.name,
      mrn: c.mrn,
      assignedToId: c.assignedToId,
      assignedToName: c.assignedTo ? c.assignedTo.name || c.assignedTo.email : null,
      locationName: c.location?.name ?? null,
      riskLevel: c.riskLevel,
      createdAt: c.createdAt,
      importedAt: c.importedAt,
      openAlertSeverities: openSev.get(c.id) ?? [],
      latestCssrsFlagged: cssrsBy.has(c.id) ? Boolean(cssrsBy.get(c.id)) : null,
      hasRiskScreen: cssrsBy.has(c.id) || anyAlert.has(c.id) || evaluated.has(c.id) || plans.ids.has(c.id),
      lastVisitAt: lastVisits.get(c.id) ?? null,
      nextAppointmentAt: nextBy.get(c.id) ?? null,
      therapyOverdue: cadenceAvailable ? cad?.therapy.status === 'overdue' : null,
      medOverdue: cadenceAvailable ? cad?.medManagement.status === 'overdue' : null,
      therapyDaysOverdue: cad?.therapy.daysOverdue ?? 0,
      measured90: measuredSet.has(c.id),
      hasSafetyPlan: plans.ids.has(c.id) || evalPlan.has(c.id),
      severePhq9: severeBy.get(c.id) ?? null,
      isProtected: Boolean(c.sensitiveRecord),
      protectedAlias: c.sensitiveRecord?.alias ?? null,
    };
  });

  const notes: string[] = [];
  if (plans.unlinked > 0) {
    notes.push(`${plans.unlinked} saved safety plan(s) have no client link (created before plans carried a client id) and are not matched to anyone.`);
  }
  if (!cadenceAvailable) notes.push('Session-frequency cadence could not be computed; overdue counts are not shown.');

  return buildPopulationReport({
    facts,
    now,
    scope,
    hiddenSensitiveClients: hidden,
    options,
    list: filters.list,
    page: filters.page,
    pageSize: filters.pageSize,
    cadenceAvailable,
    notes,
  });
}
