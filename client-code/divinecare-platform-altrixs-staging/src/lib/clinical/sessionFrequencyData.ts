import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { parseGoals } from '@/lib/ehr/treatmentPlans';
import { planCareSchema } from '@/lib/ehr/planCareSchema';
import { addCalendarDays } from '@/lib/workflows/dates';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { registerCaseloadScopedCache, scopedKey, TtlCache } from '@/lib/perf/cache';
import {
  ATTENDANCE_LOOKBACK_DAYS,
  ATTENDED_APPOINTMENT_STATUSES,
  CADENCE_WINDOW_DAYS,
  CLINIC_TIME_ZONE,
  LIKELY_INACTIVE_DAYS,
  MED_MANAGEMENT_CPT,
  THERAPY_CPT,
  assembleClientEvidence,
  dayOf,
  authorizationNotes,
  buildSessionFrequencyItem,
  sessionFrequencyClientWhere,
  sortSessionFrequencyItems,
  summarizeSessionFrequency,
  type AppointmentRow,
  type AuthInput,
  type CadenceFacts,
  type ChargeRow,
  type NoteRow,
  type PlanInput,
  type SessionFrequencyItem,
  type SessionFrequencySummary,
} from '@/lib/clinical/sessionFrequency';

export type SessionFrequencyActor = { organizationId: string; actorUserId: string; actorRole: Role };

function groupBy<T>(rows: T[], key: (r: T) => string | null) {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

type Svc = 'therapy' | 'med_management';
type FactsRow = { clientId: string; svc: Svc; last: string | null; in8w: number };
type NextRow = { clientId: string; svc: Svc; startsAt: Date; id: string };
type PlanSqlRow = { id: string; clientId: string; title: string; status: string; createdAt: Date; care: unknown };

/** "90837T" → "90837" in SQL; mirrors cptBase() */
const cptBaseSql = (col: Prisma.Sql) => Prisma.sql`upper(substring(btrim(${col}) from '^[0-9]{4}[0-9A-Za-z]'))`;

/** Prisma returns `timestamp without time zone` (stored as UTC) as a Date; normalize to the UTC instant */
const utcInstant = (d: Date | string) => new Date(`${new Date(d).toISOString().slice(0, 23)}Z`);

/**
 * Appointments with their service type, classified in SQL exactly like appointmentServiceType():
 * claim CPTs + "Valant code:" in notes first (med management wins over therapy), then the type text.
 */
function classifiedAppointmentsSql(ids: string[], since: string) {
  const med = [...MED_MANAGEMENT_CPT];
  const ther = [...THERAPY_CPT];
  return Prisma.sql`
    appt AS (
      SELECT ap."id", ap."clientId", ap."startsAt", ap."status"::text AS status,
             lower(btrim(ap."type")) AS t,
             array_remove(
               coalesce((SELECT array_agg(${cptBaseSql(Prisma.sql`c."cptCode"`)}) FROM "Claim" c WHERE c."appointmentId" = ap."id"), '{}'::text[])
                 || (upper(substring(ap."notes" from '(?i)Valant code:[[:space:]]*([0-9]{5})')))::text,
               NULL
             ) AS codes,
             EXISTS (SELECT 1 FROM "Claim" c2 WHERE c2."appointmentId" = ap."id" AND c2."cptCode" <> '') AS has_claim
      FROM "Appointment" ap
      WHERE ap."clientId" = ANY(${ids}::text[]) AND ap."startsAt" >= ${since}::timestamp
    ),
    appt_c AS (
      SELECT a.*, CASE
        WHEN a.codes && ${med}::text[] THEN 'med_management'
        WHEN a.codes && ${ther}::text[] THEN 'therapy'
        WHEN cardinality(a.codes) > 0 THEN 'other'
        WHEN a.t IS NULL OR a.t = '' THEN 'unknown'
        WHEN a.t IN ('individual therapy', 'individual psychotherapy') THEN 'therapy'
        WHEN a.t LIKE '%medication management%' OR a.t LIKE '%medication review%' OR a.t = 'med management' THEN 'med_management'
        WHEN a.t IN ('telehealth', 'appointment', 'telehealth check-in') THEN 'unknown'
        ELSE 'other' END AS svc
      FROM appt a
    )`;
}

/**
 * Org-wide: last attended day, attended days in the 8-week window and the next scheduled visit,
 * per client and service type — two aggregate queries instead of reading every row.
 * Evidence rules are the same as assembleClientEvidence().
 */
async function loadCadenceFacts(organizationId: string, ids: string[], now: Date) {
  const tz = CLINIC_TIME_ZONE;
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - ATTENDANCE_LOOKBACK_DAYS * 86_400_000).toISOString();
  const today = dayOf(now);
  const windowStart = addCalendarDays(today, -CADENCE_WINDOW_DAYS);
  const med = [...MED_MANAGEMENT_CPT];
  const ther = [...THERAPY_CPT];
  const attended = [...ATTENDED_APPOINTMENT_STATUSES];
  const localDay = (col: Prisma.Sql) => Prisma.sql`((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;
  const svcOf = (base: Prisma.Sql) =>
    Prisma.sql`CASE WHEN ${base} = ANY(${med}::text[]) THEN 'med_management' WHEN ${base} = ANY(${ther}::text[]) THEN 'therapy' END`;

  const [facts, next] = await Promise.all([
    prisma.$queryRaw<FactsRow[]>(Prisma.sql`
      WITH ${classifiedAppointmentsSql(ids, since)},
      ev AS (
        SELECT "clientId", svc, ${localDay(Prisma.sql`"startsAt"`)} AS day
        FROM appt_c
        WHERE "startsAt" <= ${nowIso}::timestamp AND svc IN ('therapy', 'med_management')
          AND (status = ANY(${attended}::text[]) OR (status = 'SCHEDULED' AND has_claim))
        UNION ALL
        SELECT n."clientId", ${svcOf(Prisma.sql`n.b`)}, n.day
        FROM (
          SELECT pn."clientId", ${cptBaseSql(Prisma.sql`pn."cptCode"`)} AS b,
                 CASE WHEN pn."dateOfService" IS NOT NULL THEN pn."dateOfService"::date ELSE ${localDay(Prisma.sql`pn."createdAt"`)} END AS day,
                 CASE WHEN pn."dateOfService" IS NOT NULL THEN pn."dateOfService"::date + interval '12 hours' ELSE pn."createdAt" END AS at
          FROM "ProgressNote" pn
          JOIN "ProgressNoteWorkflow" w ON w."noteId" = pn."id" AND w."status"::text IN ('SIGNED', 'LOCKED')
          WHERE pn."clientId" = ANY(${ids}::text[]) AND pn."cptCode" IS NOT NULL
            AND (pn."dateOfService" >= ${since}::timestamp OR (pn."dateOfService" IS NULL AND pn."createdAt" >= ${since}::timestamp))
        ) n
        WHERE n.at <= ${nowIso}::timestamp AND (n.b = ANY(${med}::text[]) OR n.b = ANY(${ther}::text[]))
        UNION ALL
        SELECT v."clientId", ${svcOf(Prisma.sql`v.b`)}, v.day
        FROM (
          SELECT vt."clientId", ${cptBaseSql(Prisma.sql`vt."codeBase"`)} AS b, vt."serviceDate"::date AS day
          FROM "ValantTransaction" vt
          WHERE vt."organizationId" = ${organizationId} AND vt."clientId" = ANY(${ids}::text[])
            AND vt."category" = 'charge' AND vt."codeBase" IS NOT NULL
            AND vt."serviceDate" >= ${since}::timestamp AND vt."serviceDate" <= ${nowIso}::timestamp
          GROUP BY vt."clientId", coalesce(vt."billingId", ''), vt."serviceDate"::date, vt."codeBase"
          HAVING sum(vt."amountCents") > 0
        ) v
        WHERE v.b = ANY(${med}::text[]) OR v.b = ANY(${ther}::text[])
      )
      SELECT "clientId", svc, max(day)::text AS last,
             (count(DISTINCT day) FILTER (WHERE day > ${windowStart}::date))::int AS in8w
      FROM ev
      WHERE day <= ${today}::date
      GROUP BY "clientId", svc`),
    prisma.$queryRaw<NextRow[]>(Prisma.sql`
      WITH ${classifiedAppointmentsSql(ids, nowIso)}
      SELECT DISTINCT ON ("clientId", svc) "clientId", svc, "startsAt", "id"
      FROM appt_c
      WHERE status = 'SCHEDULED' AND "startsAt" > ${nowIso}::timestamp AND svc IN ('therapy', 'med_management')
      ORDER BY "clientId", svc, "startsAt" ASC`),
  ]);

  const empty = (): CadenceFacts => ({ lastAttended: null, sessionsLast8Weeks: 0, next: null });
  const byClient = new Map<string, Record<Svc, CadenceFacts>>();
  const get = (id: string) => {
    let f = byClient.get(id);
    if (!f) {
      f = { therapy: empty(), med_management: empty() };
      byClient.set(id, f);
    }
    return f;
  };
  for (const r of facts) {
    const f = get(r.clientId)[r.svc];
    f.lastAttended = r.last;
    f.sessionsLast8Weeks = Number(r.in8w) || 0;
  }
  for (const r of next) get(r.clientId)[r.svc].next = { at: utcInstant(r.startsAt), appointmentId: r.id };
  return byClient;
}

/**
 * Latest contact per client within LIKELY_INACTIVE_DAYS: any appointment except a cancellation
 * (no-shows and future bookings count: the client is still scheduled) or any progress note.
 * Clients with none are absent from the map (null contact).
 */
async function loadLastContact(ids: string[], now: Date): Promise<Map<string, string>> {
  const since = new Date(now.getTime() - LIKELY_INACTIVE_DAYS * 86_400_000);
  const [appts, notes] = await Promise.all([
    prisma.appointment.groupBy({
      by: ['clientId'],
      where: { clientId: { in: ids }, startsAt: { gte: since }, status: { notIn: ['CANCELLED', 'LATE_CANCEL'] } },
      _max: { startsAt: true },
    }),
    prisma.progressNote.groupBy({
      by: ['clientId'],
      where: { clientId: { in: ids }, dismissedAt: null, OR: [{ dateOfService: { gte: since } }, { createdAt: { gte: since } }] },
      _max: { dateOfService: true, createdAt: true },
    }),
  ]);
  const out = new Map<string, string>();
  const bump = (clientId: string, d: Date | null | undefined) => {
    if (!d) return;
    const day = dayOf(d);
    const cur = out.get(clientId);
    if (!cur || day > cur) out.set(clientId, day);
  };
  for (const a of appts) bump(a.clientId, a._max.startsAt);
  for (const n of notes) {
    bump(n.clientId, n._max.dateOfService);
    bump(n.clientId, n._max.createdAt);
  }
  return out;
}

/** Contact lookup that never takes the alert down: on failure, nobody is marked likely inactive */
async function loadLastContactSafe(ids: string[], now: Date): Promise<Map<string, string> | null> {
  try {
    return await loadLastContact(ids, now);
  } catch (err) {
    console.error('[session-frequency] last contact lookup failed', err instanceof Error ? err.message : 'unknown');
    return null;
  }
}

/** Plan frequency fields only (not the whole goals JSON), validated like parseGoals() */
async function loadPlanInputs(organizationId: string, ids: string[]) {
  const rows = await prisma.$queryRaw<PlanSqlRow[]>(Prisma.sql`
    SELECT "id", "clientId", "title", "status"::text AS status, "createdAt", "goals"->'clinicalDetails' AS care
    FROM "TreatmentPlan"
    WHERE "organizationId" = ${organizationId} AND "clientId" = ANY(${ids}::text[])
      AND "status"::text IN ('ACTIVE', 'NEEDS_REVIEW')
      AND coalesce("goals"->'clinicalDetails'->>'serviceFrequency', '') <> ''`);
  const byClient = new Map<string, PlanInput[]>();
  for (const r of rows) {
    const care = planCareSchema.safeParse(r.care);
    const plan: PlanInput = {
      id: r.id,
      title: r.title,
      status: r.status,
      createdAt: utcInstant(r.createdAt),
      planType: care.success ? care.data.planType : '',
      serviceFrequency: care.success ? care.data.serviceFrequency : '',
    };
    byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), plan]);
  }
  return byClient;
}

/**
 * The one loader behind the client-directory banner, the alerts list and the chart card.
 * Count and list are both derived from the returned items.
 *
 * Org-wide (no clientId) reads SQL aggregates per client; one client (or `detail: true`) reads
 * the rows so the chart can list what was not counted. Both feed the same cadence rules, so a
 * client lands in the same bucket either way (tests/session-frequency.test.ts).
 */
export async function loadSessionFrequency(
  actor: SessionFrequencyActor,
  opts: { clientId?: string; locationId?: string; clientIds?: string[]; detail?: boolean; fresh?: boolean } = {},
  now = new Date()
): Promise<{ items: SessionFrequencyItem[]; summary: SessionFrequencySummary }> {
  const detail = opts.detail ?? Boolean(opts.clientId);
  // Whole-scope reads (inbox, role home, population health, client-directory banner) share one
  // computation per viewer for 60s. Items depend on caseload and Part 2 access, so the key is
  // org + user + role (+ location); single-chart and explicit-id reads are never cached.
  if (!detail && !opts.clientId && !opts.clientIds) {
    const key = scopedKey(
      { organizationId: actor.organizationId, userId: actor.actorUserId, role: String(actor.actorRole) },
      'session-frequency',
      opts.locationId ?? 'all'
    );
    return sessionFrequencyCache.getOrCompute(key, () => loadSessionFrequencyUncached(actor, opts, now), { fresh: opts.fresh });
  }
  return loadSessionFrequencyUncached(actor, opts, now);
}

/** Org-wide session-frequency results per viewer + location */
export const SESSION_FREQUENCY_CACHE_TTL_MS = 60_000;
const sessionFrequencyCache = registerCaseloadScopedCache(
  new TtlCache<{ items: SessionFrequencyItem[]; summary: SessionFrequencySummary }>(SESSION_FREQUENCY_CACHE_TTL_MS, 500)
);

async function loadSessionFrequencyUncached(
  actor: SessionFrequencyActor,
  opts: { clientId?: string; locationId?: string; clientIds?: string[]; detail?: boolean },
  now: Date
): Promise<{ items: SessionFrequencyItem[]; summary: SessionFrequencySummary }> {
  const detail = opts.detail ?? Boolean(opts.clientId);
  if (!detail) {
    try {
      return await loadSessionFrequencySummary(actor, opts, now);
    } catch (err) {
      // Never lose the alert over the aggregate query: fall back to reading rows (slower, same result)
      console.error('[session-frequency] aggregate query failed; falling back to row reads', err);
    }
  }
  const clients = await prisma.client.findMany({
    where: sessionFrequencyClientWhere(actor, opts),
    select: {
      id: true,
      name: true,
      riskLevel: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      locationId: true,
      location: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });
  if (!clients.length) return { items: [], summary: summarizeSessionFrequency([]) };

  const ids = clients.map((c) => c.id);
  const since = new Date(now.getTime() - ATTENDANCE_LOOKBACK_DAYS * 86_400_000);

  const [appointments, notes, charges, plans, auths, sensitive, lastContact] = await Promise.all([
    prisma.appointment.findMany({
      where: { clientId: { in: ids }, startsAt: { gte: since } },
      select: {
        id: true,
        clientId: true,
        type: true,
        notes: true,
        status: true,
        startsAt: true,
        claims: { select: { cptCode: true } },
      },
    }),
    prisma.progressNote.findMany({
      where: {
        clientId: { in: ids },
        cptCode: { not: null },
        workflow: { status: { in: ['SIGNED', 'LOCKED'] } },
        OR: [{ dateOfService: { gte: since } }, { dateOfService: null, createdAt: { gte: since } }],
      },
      select: { clientId: true, cptCode: true, dateOfService: true, createdAt: true },
    }),
    prisma.valantTransaction.findMany({
      where: {
        organizationId: actor.organizationId,
        clientId: { in: ids },
        category: 'charge',
        codeBase: { not: null },
        serviceDate: { gte: since },
      },
      select: { clientId: true, serviceDate: true, codeBase: true, billingId: true, amountCents: true },
    }),
    prisma.treatmentPlan.findMany({
      where: { organizationId: actor.organizationId, clientId: { in: ids }, status: { in: ['ACTIVE', 'NEEDS_REVIEW'] } },
      select: { id: true, clientId: true, title: true, status: true, createdAt: true, goals: true },
    }),
    prisma.priorAuth.findMany({
      where: { organizationId: actor.organizationId, clientId: { in: ids }, status: 'APPROVED' },
      select: {
        id: true,
        clientId: true,
        authNumber: true,
        payer: true,
        status: true,
        cptCodes: true,
        unitsApproved: true,
        unitsUsed: true,
        startDate: true,
        endDate: true,
      },
    }),
    resolveSensitiveAccessMap({
      organizationId: actor.organizationId,
      userId: actor.actorUserId,
      role: actor.actorRole,
      clientIds: ids,
    }).catch((err) => {
      console.error('[session-frequency] sensitive access map failed', err);
      return null;
    }),
    loadLastContactSafe(ids, now),
  ]);

  const apptsBy = groupBy(appointments, (a) => a.clientId);
  const notesBy = groupBy(notes, (n) => n.clientId);
  const chargesBy = groupBy(charges, (c) => c.clientId);
  const plansBy = groupBy(plans, (p) => p.clientId);
  const authsBy = groupBy(auths, (a) => a.clientId);

  const items = clients.map((c) => {
    const appts: AppointmentRow[] = (apptsBy.get(c.id) ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      notes: a.notes,
      status: a.status,
      startsAt: a.startsAt,
      claimCpts: a.claims.map((x) => x.cptCode).filter(Boolean),
    }));
    const planInputs: PlanInput[] = (plansBy.get(c.id) ?? []).map((p) => {
      const care = parseGoals(p.goals).clinicalDetails;
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        createdAt: p.createdAt,
        planType: care?.planType ?? '',
        serviceFrequency: care?.serviceFrequency ?? '',
      };
    });
    const authInputs: AuthInput[] = authsBy.get(c.id) ?? [];
    const built = assembleClientEvidence(
      {
        appointments: appts,
        notes: (notesBy.get(c.id) ?? []) as NoteRow[],
        charges: (chargesBy.get(c.id) ?? []) as ChargeRow[],
      },
      now
    );
    const s = sensitive?.get(c.id);
    // Sensitive-access lookup failed: lock every row rather than show protected names
    const locked = sensitive === null || Boolean(s && !s.canAccessSensitive);
    return buildSessionFrequencyItem(
      {
        clientId: c.id,
        clientName: locked ? s?.alias || 'Protected Client' : c.name,
        locked,
        assignedToId: c.assignedToId,
        assignedToName: c.assignedTo?.name ?? null,
        locationId: c.locationId,
        locationName: c.location?.name ?? null,
        riskLevel: c.riskLevel,
        plans: planInputs,
        auths: authInputs,
        ...built,
        authNotes: authorizationNotes(authInputs, now),
        lastContact: lastContact ? lastContact.get(c.id) ?? null : undefined,
      },
      now
    );
  });

  const sorted = sortSessionFrequencyItems(items);
  return { items: sorted, summary: summarizeSessionFrequency(sorted) };
}

/** Org-wide path: aggregates per client (no row reads), same items/summary shape */
async function loadSessionFrequencySummary(
  actor: SessionFrequencyActor,
  opts: { clientId?: string; locationId?: string; clientIds?: string[] },
  now: Date
): Promise<{ items: SessionFrequencyItem[]; summary: SessionFrequencySummary }> {
  const clients = await prisma.client.findMany({
    where: sessionFrequencyClientWhere(actor, opts),
    select: {
      id: true,
      name: true,
      riskLevel: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      locationId: true,
      location: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });
  if (!clients.length) return { items: [], summary: summarizeSessionFrequency([]) };
  const ids = clients.map((c) => c.id);

  const [facts, plansBy, auths, sensitive, lastContact] = await Promise.all([
    loadCadenceFacts(actor.organizationId, ids, now),
    loadPlanInputs(actor.organizationId, ids),
    prisma.priorAuth.findMany({
      where: { organizationId: actor.organizationId, clientId: { in: ids }, status: 'APPROVED' },
      select: {
        id: true,
        clientId: true,
        authNumber: true,
        payer: true,
        status: true,
        cptCodes: true,
        unitsApproved: true,
        unitsUsed: true,
        startDate: true,
        endDate: true,
      },
    }),
    resolveSensitiveAccessMap({
      organizationId: actor.organizationId,
      userId: actor.actorUserId,
      role: actor.actorRole,
      clientIds: ids,
    }).catch((err) => {
      console.error('[session-frequency] sensitive access map failed', err);
      return null;
    }),
    loadLastContactSafe(ids, now),
  ]);
  const authsBy = groupBy(auths, (a) => a.clientId);
  const noFacts: Record<Svc, CadenceFacts> = {
    therapy: { lastAttended: null, sessionsLast8Weeks: 0, next: null },
    med_management: { lastAttended: null, sessionsLast8Weeks: 0, next: null },
  };

  const items = clients.map((c) => {
    const s = sensitive?.get(c.id);
    const locked = sensitive === null || Boolean(s && !s.canAccessSensitive);
    const authInputs: AuthInput[] = authsBy.get(c.id) ?? [];
    return buildSessionFrequencyItem(
      {
        clientId: c.id,
        clientName: locked ? s?.alias || 'Protected Client' : c.name,
        locked,
        assignedToId: c.assignedToId,
        assignedToName: c.assignedTo?.name ?? null,
        locationId: c.locationId,
        locationName: c.location?.name ?? null,
        riskLevel: c.riskLevel,
        plans: plansBy.get(c.id) ?? [],
        auths: authInputs,
        evidence: [],
        scheduled: [],
        // Row-level "not counted" tallies are only computed for one chart (detail path)
        unconfirmedPastAppointments: 0,
        unknownTypeVisits: 0,
        authNotes: authorizationNotes(authInputs, now),
        facts: facts.get(c.id) ?? noFacts,
        lastContact: lastContact ? lastContact.get(c.id) ?? null : undefined,
      },
      now
    );
  });

  const sorted = sortSessionFrequencyItems(items);
  return { items: sorted, summary: summarizeSessionFrequency(sorted) };
}
