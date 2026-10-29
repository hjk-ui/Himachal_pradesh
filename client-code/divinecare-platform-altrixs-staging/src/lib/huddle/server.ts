import 'server-only';
/**
 * Huddle sheet loader (GET /api/huddle): one provider's visits for one practice day, each with a
 * one-line summary copied from the latest chart history digest (no AI call) and deterministic
 * flags from structured chart rows. All chart reads are batched across the day's clients.
 *
 * Access: the viewer must be able to open the huddle (canViewHuddle); the provider is the viewer
 * unless leadership picked one (resolveHuddleProvider); clients pass the viewer's caseload rule
 * (huddleAppointmentWhere → clientAccessWhere). Protected records the viewer is not cleared for
 * show the alias only, with no summary, MRN or flags. Part 2 facts never reach the summary.
 * Which digest a viewer reads follows the digest access rules (canViewChartDigest).
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { practiceDayBounds } from '@/lib/dashboard/practiceDay';
import { PROTECTED_CLIENT_DISPLAY } from '@/lib/dashboard/todaySchedule';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { buildAppointmentLocationResolver, effectiveLocation } from '@/lib/locations/effectiveLocation';
import { canAccessClientChartNotes, canSeeClientInsurance } from '@/lib/clients/orgScope';
import { safetyPlansForClient } from '@/lib/clients/chartSections';
import { canUseClinicModule } from '@/lib/modules/access';
import { getModuleData } from '@/lib/modules/manage';
import { loadComplianceRows } from '@/lib/consents/library/store';
import { audienceFor } from '@/lib/ai/previsit/service';
import { canViewChartDigest, type DigestKind } from '@/lib/ai/chartDigest/access';
import { digestKindForVisit } from '@/lib/ai/chartDigest/prep';
import { parseDigestJson, withoutPart2 } from '@/lib/ai/chartDigest/service';
import { parseMedicalDigestJson } from '@/lib/ai/chartDigest/medical/service';
import { chartDigestCitationLinks } from '@/lib/ai/chartDigest/citationLinks';
import type { StaffRole } from '@/types/roles';
import {
  HUDDLE_MAX_VISITS,
  HUDDLE_NOT_PREPARED,
  deriveHuddleFlags,
  digestSummaryLine,
  huddleAppointmentWhere,
  huddleCounts,
  huddleDayLabel,
  summarySources,
  type HuddleFlag,
  type HuddleSheet,
  type HuddleSummary,
  type HuddleVisit,
} from './core';

const DAY_MS = 86_400_000;
const MED_LOOKBACK_DAYS = 120;
const LAB_LOOKBACK_DAYS = 730;
const ATTENDED = ['COMPLETED', 'CHECKED_IN', 'IN_SESSION'] as const;

export type HuddleViewer = { organizationId: string; userId: string; role: Role };

async function appointmentLocations(ids: string[]): Promise<Map<string, string | null>> {
  const own = new Map<string, string | null>();
  if (!ids.length) return own;
  try {
    const rows = await prisma.$queryRaw<{ id: string; loc: string | null }[]>`SELECT "id", "location_id"::text AS "loc" FROM "Appointment" WHERE "id" = ANY(${ids}::text[])`;
    for (const r of rows) own.set(r.id, r.loc);
  } catch {
    // Column not migrated on this database: fall back to the client's home location
  }
  return own;
}

type LatestDigestRow = { clientId: string; kind: string; status: string; generatedAt: Date; digest: unknown };

/** Latest digest per client + kind, the digest part of the JSON only (never the chunk cache) */
async function latestDigests(organizationId: string, clientIds: string[]): Promise<Map<string, LatestDigestRow>> {
  const out = new Map<string, LatestDigestRow>();
  if (!clientIds.length) return out;
  const rows = await prisma.$queryRaw<LatestDigestRow[]>`
    SELECT DISTINCT ON ("clientId", "kind") "clientId", "kind", "status", "generatedAt", "digestJson"->'digest' AS "digest"
    FROM "ClientChartDigest"
    WHERE "organizationId" = ${organizationId} AND "clientId" = ANY(${clientIds}::text[])
    ORDER BY "clientId", "kind", "version" DESC`;
  for (const r of rows) out.set(`${r.clientId}:${r.kind}`, r);
  return out;
}

const settle = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

export async function loadHuddleSheet(viewer: HuddleViewer, input: { providerId: string; date: string; compact?: boolean }, now = new Date()): Promise<HuddleSheet> {
  const org = viewer.organizationId;
  const role = String(viewer.role);
  const timeZone = await getPracticeTimeZone(org);
  const { start, end } = practiceDayBounds(input.date, timeZone);
  const day = (d: Date) => toPracticeWallTime(d, timeZone).date;

  const [provider, appts] = await Promise.all([
    prisma.user.findFirst({ where: { id: input.providerId, organizationId: org }, select: { id: true, name: true } }),
    prisma.appointment.findMany({
      where: huddleAppointmentWhere(viewer, input.providerId, { start, end }),
      orderBy: { startsAt: 'asc' },
      take: HUDDLE_MAX_VISITS,
      select: {
        id: true,
        clientId: true,
        clientName: true,
        type: true,
        startsAt: true,
        endsAt: true,
        status: true,
        isVirtual: true,
        notes: true,
        clinician: { select: { role: true } },
        client: { select: { name: true, mrn: true, riskLevel: true, locationId: true, sensitiveRecord: { select: { alias: true } } } },
      },
    }),
  ]);
  // A provider outside the org (or a stale id) has no schedule here
  const list = provider ? appts : [];

  const sensitiveIds = [...new Set(list.filter((a) => a.client.sensitiveRecord).map((a) => a.clientId))];
  const locked = sensitiveIds.length
    ? await lockedSensitiveClientIds({ organizationId: org, userId: viewer.userId, role: viewer.role, clientIds: sensitiveIds }).catch(() => new Set(sensitiveIds))
    : new Set<string>();
  const ids = [...new Set(list.filter((a) => !locked.has(a.clientId)).map((a) => a.clientId))];

  // Gates mirror the pre-visit brief (labs: prescribers / primary care; measures: BH chart-note readers)
  const audience = audienceFor(role);
  const gates = {
    labs: audience === 'prescriber' || audience === 'primary_care',
    measures: canAccessClientChartNotes(role),
    auths: canSeeClientInsurance(role),
    safetyPlans: canUseClinicModule(role as StaffRole, 'ehr-safety-plans'),
  };
  const none = <T>() => Promise.resolve([] as T[]);
  const has = ids.length > 0;
  const [locations, ownLoc, riskAlerts, assessments, measurements, medications, lastVisits, labOrders, assignments, plans, auths, compliance, planData, digests] = await Promise.all([
    prisma.location.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
    appointmentLocations(list.map((a) => a.id)),
    has
      ? prisma.riskAlert.findMany({
          where: { clientId: { in: ids }, reviewed: false, OR: [{ organizationId: org }, { organizationId: null }] },
          select: { id: true, clientId: true, type: true, severity: true, reviewed: true, createdAt: true },
          take: 500,
        })
      : none<{ id: string; clientId: string; type: string; severity: string; reviewed: boolean; createdAt: Date }>(),
    has
      ? prisma.clinicalAssessmentRecord.findMany({
          where: { organizationId: org, clientId: { in: ids } },
          select: { id: true, clientId: true, instrumentId: true, instrumentName: true, totalScore: true, severity: true, safetyFlagged: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 2000,
        })
      : none<{ id: string; clientId: string; instrumentId: string; instrumentName: string; totalScore: number | null; severity: string | null; safetyFlagged: boolean; createdAt: Date }>(),
    has && gates.measures
      ? prisma.measurementResult.findMany({
          where: { organizationId: org, clientId: { in: ids }, measurementType: { isSubscore: false } },
          select: { clientId: true, measuredAt: true, measurementType: { select: { instrumentKey: true } } },
          orderBy: { measuredAt: 'desc' },
          take: 2000,
        })
      : none<{ clientId: string; measuredAt: Date; measurementType: { instrumentKey: string | null } }>(),
    has
      ? prisma.clientMedication.findMany({
          where: { clientId: { in: ids }, OR: [{ active: true }, { updatedAt: { gte: new Date(now.getTime() - MED_LOOKBACK_DAYS * DAY_MS) } }] },
          select: {
            clientId: true,
            medicationName: true,
            drugName: true,
            dosage: true,
            dosageText: true,
            route: true,
            frequency: true,
            instructions: true,
            asNeeded: true,
            isAntipsychotic: true,
            startDate: true,
            createdAt: true,
            stopDate: true,
            endDate: true,
            active: true,
            status: true,
            rcopiaMedId: true,
          },
          take: 1000,
        })
      : none<never>(),
    has
      ? prisma.appointment.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, startsAt: { lt: start }, status: { in: [...ATTENDED] } }, _max: { startsAt: true } })
      : none<{ clientId: string; _max: { startsAt: Date | null } }>(),
    has && gates.labs
      ? prisma.labOrder.findMany({
          where: { organizationId: org, clientId: { in: ids }, orderedAt: { gte: new Date(now.getTime() - LAB_LOOKBACK_DAYS * DAY_MS) } },
          select: {
            clientId: true,
            id: true,
            status: true,
            orderedAt: true,
            collectedAt: true,
            resultedAt: true,
            panels: true,
            results: { select: { id: true, testName: true, testKey: true, value: true, unit: true, refRange: true, flag: true, collectedAt: true, createdAt: true } },
          },
          take: 600,
        })
      : none<never>(),
    has && gates.measures
      ? prisma.measureAssignment.findMany({
          where: { organizationId: org, clientId: { in: ids }, status: 'active' },
          select: { clientId: true, instrumentId: true, schedule: true, everyDays: true, startDate: true, endDate: true, status: true },
          take: 500,
        })
      : none<never>(),
    has
      ? prisma.treatmentPlan.findMany({
          where: { organizationId: org, clientId: { in: ids }, status: { in: ['ACTIVE', 'NEEDS_REVIEW', 'DRAFT'] } },
          select: { clientId: true, status: true, reviewDueAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 500,
        })
      : none<{ clientId: string; status: string; reviewDueAt: Date | null }>(),
    has && gates.auths
      ? prisma.priorAuth.findMany({
          where: { organizationId: org, clientId: { in: ids } },
          select: { id: true, clientId: true, payer: true, authNumber: true, cptCodes: true, unitsApproved: true, unitsUsed: true, status: true, startDate: true, endDate: true },
          take: 500,
        })
      : none<never>(),
    has ? settle(loadComplianceRows({ organizationId: org }, org, { clientIds: ids, now }), null) : Promise.resolve(null),
    has && gates.safetyPlans ? settle(getModuleData<unknown>(org, 'ehr-safety-plans'), null) : Promise.resolve(null),
    input.compact || !has ? Promise.resolve(new Map<string, LatestDigestRow>()) : settle(latestDigests(org, ids), new Map<string, LatestDigestRow>()),
  ]);

  const group = <T extends { clientId: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.clientId, [...(m.get(r.clientId) ?? []), r]);
    return m;
  };
  const alertsBy = group(riskAlerts);
  const assessBy = group(assessments);
  const measBy = group(measurements);
  const medsBy = group(medications as Array<{ clientId: string }>);
  const labsBy = group(labOrders as Array<{ clientId: string }>);
  const assignBy = group(assignments as Array<{ clientId: string }>);
  const plansBy = group(plans);
  const authsBy = group(auths as Array<{ clientId: string }>);
  const lastBy = new Map(lastVisits.map((r) => [r.clientId, r._max.startsAt ?? null]));
  const consentBy = new Map<string, { title: string; standard: string }[]>();
  for (const r of compliance ?? []) {
    if (!r.required || r.standard === 'complete') continue;
    consentBy.set(r.clientId, [...(consentBy.get(r.clientId) ?? []), { title: r.title, standard: r.standard }]);
  }
  const resolve = buildAppointmentLocationResolver(locations);
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const rank = (s: string) => (s === 'ACTIVE' ? 0 : s === 'NEEDS_REVIEW' ? 1 : 2);

  const flagsFor = (clientId: string, riskLevel: string): HuddleFlag[] => {
    const assess = assessBy.get(clientId) ?? [];
    const cssrs = assess.find((a) => a.instrumentId.toLowerCase().startsWith('c-ssrs')) ?? null;
    const scoreDays = new Map<string, string>();
    for (const a of assess) {
      const k = a.instrumentId.toLowerCase();
      const d = day(a.createdAt);
      if (!scoreDays.has(k) || d > scoreDays.get(k)!) scoreDays.set(k, d);
    }
    for (const m of measBy.get(clientId) ?? []) {
      const k = String(m.measurementType.instrumentKey || '').toLowerCase();
      const d = day(m.measuredAt);
      if (k && (!scoreDays.has(k) || d > scoreDays.get(k)!)) scoreDays.set(k, d);
    }
    const plan = [...(plansBy.get(clientId) ?? [])].sort((a, b) => rank(String(a.status)) - rank(String(b.status)))[0] ?? null;
    return deriveHuddleFlags({
      asOf: start,
      asOfYmd: input.date,
      day,
      riskLevel,
      riskAlerts: (alertsBy.get(clientId) ?? []).map((a) => ({ ...a, severity: String(a.severity) })),
      latestCssrs: cssrs,
      safetyPlanOnFile: gates.safetyPlans ? safetyPlansForClient(planData, { id: clientId, name: '' }).matched.length > 0 : null,
      medications: (medsBy.get(clientId) ?? []) as never,
      lastVisitAt: lastBy.get(clientId) ?? null,
      labOrders: gates.labs ? ((labsBy.get(clientId) ?? []) as unknown as Array<{ status: unknown }>).map((o) => ({ ...o, status: String(o.status) })) as never : null,
      measureAssignments: gates.measures ? ((assignBy.get(clientId) ?? []) as never) : null,
      scoreDays,
      treatmentPlan: plan ? { status: String(plan.status), reviewDueAt: plan.reviewDueAt } : null,
      consentGaps: compliance ? consentBy.get(clientId) ?? [] : null,
      auths: gates.auths ? ((authsBy.get(clientId) ?? []) as never) : null,
    });
  };

  const summaryFor = async (a: (typeof list)[number]): Promise<{ summary: HuddleSummary; note: string | null }> => {
    const wanted: DigestKind = digestKindForVisit({ type: a.type, notes: a.notes, clinicianRole: a.clinician?.role ? String(a.clinician.role) : null });
    const kind: DigestKind | null =
      wanted === 'medical' && canViewChartDigest(role, 'medical') ? 'medical' : canViewChartDigest(role, 'bh') ? 'bh' : canViewChartDigest(role, 'medical') ? 'medical' : null;
    if (!kind) return { summary: null, note: 'Chart history summary is not available for your role' };
    const row = digests.get(`${a.clientId}:${kind}`);
    if (!row || row.status === 'failed' || !row.digest) return { summary: null, note: HUDDLE_NOT_PREPARED };
    let line: ReturnType<typeof digestSummaryLine> = null;
    let sources: Record<string, { date: string; label: string; part2: boolean }> = {};
    if (kind === 'medical') {
      const mj = parseMedicalDigestJson({ digest: row.digest });
      if (mj) {
        line = digestSummaryLine({ kind: 'medical', digest: mj.digest }, audience);
        sources = mj.digest.sources ?? {};
      }
    } else {
      const bj = parseDigestJson({ digest: row.digest });
      if (bj) {
        // The huddle never shows Part 2 content (same rule as the pre-visit brief)
        const d = withoutPart2({ ...bj.digest, sources: bj.digest.sources ?? {} });
        line = digestSummaryLine({ kind: 'bh', digest: d }, audience);
        sources = d.sources;
      }
    }
    if (!line) return { summary: null, note: HUDDLE_NOT_PREPARED };
    const keys = [...new Set(line.cites.map((c) => c.source))];
    const links = keys.length ? await chartDigestCitationLinks({ organizationId: org, userId: viewer.userId, role }, a.clientId, keys).catch(() => ({})) : {};
    return { summary: { text: line.text, generated: day(row.generatedAt), sources: summarySources(line.cites, sources, links) }, note: null };
  };

  const visits: HuddleVisit[] = [];
  const flagCache = new Map<string, HuddleFlag[]>();
  for (const a of list) {
    const isLocked = locked.has(a.clientId);
    const isSensitive = Boolean(a.client.sensitiveRecord);
    const loc = effectiveLocation({ appointmentLocation: ownLoc.get(a.id) ?? null, clientLocationId: a.client.locationId }, resolve);
    const base = {
      id: a.id,
      startTime: toPracticeWallTime(a.startsAt, timeZone).time,
      endTime: toPracticeWallTime(a.endsAt, timeZone).time,
      status: String(a.status),
      isVirtual: a.isVirtual,
      locationName: a.isVirtual ? null : loc.locationId ? locName.get(loc.locationId) ?? null : null,
    };
    if (isLocked) {
      visits.push({
        ...base,
        clientId: null,
        clientName: a.client.sensitiveRecord?.alias?.trim() || PROTECTED_CLIENT_DISPLAY,
        mrn: null,
        protected: true,
        type: 'Protected appointment',
        summary: null,
        summaryNote: 'Protected record: open the chart with access to see details',
        flags: [],
      });
      continue;
    }
    if (!flagCache.has(a.clientId)) flagCache.set(a.clientId, flagsFor(a.clientId, String(a.client.riskLevel)));
    const s = input.compact ? { summary: null, note: null } : await summaryFor(a);
    visits.push({
      ...base,
      clientId: a.clientId,
      clientName: isSensitive ? a.client.sensitiveRecord?.alias?.trim() || PROTECTED_CLIENT_DISPLAY : a.clientName?.trim() || a.client.name,
      mrn: a.client.mrn ?? null,
      protected: isSensitive,
      type: a.type,
      summary: s.summary,
      summaryNote: s.note,
      flags: flagCache.get(a.clientId) ?? [],
    });
  }

  return {
    date: input.date,
    timeZone,
    day: huddleDayLabel(input.date, now, timeZone),
    provider: { id: input.providerId, name: provider?.name ?? null },
    visits,
    counts: huddleCounts(visits),
    generatedAt: now.toISOString(),
  };
}

const HUDDLE_PROVIDER_ROLES: Role[] = ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'ADMIN'];

/** Providers leadership can pick (active staff in the org with a role that can hold a huddle) */
export async function listHuddleProviders(organizationId: string): Promise<{ id: string; name: string; role: string }[]> {
  const rows = await prisma.user.findMany({
    where: { organizationId, status: 'ACTIVE', OR: [{ role: { in: HUDDLE_PROVIDER_ROLES } }, { roles: { hasSome: HUDDLE_PROVIDER_ROLES } }] },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
    take: 300,
  });
  return rows.map((r) => ({ id: r.id, name: r.name?.trim() || r.email, role: String(r.role) }));
}
