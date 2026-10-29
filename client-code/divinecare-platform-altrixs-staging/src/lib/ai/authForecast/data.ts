import 'server-only';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { parseGoals } from '@/lib/ehr/treatmentPlans';
import { addCalendarDays } from '@/lib/workflows/dates';
import { scopedKey, TtlCache } from '@/lib/perf/cache';
import {
  ATTENDANCE_LOOKBACK_DAYS,
  assembleClientEvidence,
  dayOf,
  type AppointmentRow,
  type ChargeRow,
  type NoteRow,
} from '@/lib/clinical/sessionFrequency';
import {
  EXPIRED_LOOKBACK_DAYS,
  authServiceTypes,
  computeAuthForecast,
  expectedDurationDays,
  leadTimeConfigFromEnv,
  renewalLeadTime,
  renewalRequest,
  sortForecasts,
  summarizeForecasts,
  visitMatchesAuth,
  type AuthForecast,
  type AuthForecastSummary,
  type ForecastAuthInput,
} from './forecast';
import { summarizeGoals, type RenewalFacts } from './draft';

/**
 * Loads approved prior auths (Valant imports and native) with the visit evidence the session-frequency
 * alert uses (attended appointments, claims, signed notes, Valant charges — assembleClientEvidence)
 * and computes one forecast per auth.
 */

export type ForecastActor = { organizationId: string; actorUserId: string; actorRole: Role };

const DAY_MS = 86_400_000;
const AUTH_SELECT = {
  id: true,
  clientId: true,
  payer: true,
  authNumber: true,
  cptCodes: true,
  unitsApproved: true,
  unitsUsed: true,
  status: true,
  startDate: true,
  endDate: true,
  vendor: true,
  notes: true,
} as const;

type PlanRow = {
  id: string;
  clientId: string;
  title: string;
  reviewDueAt: Date | null;
  createdAt: Date;
  clinicianSignedAt: Date | null;
  diagnosisCodes: string[];
  goals: Prisma.JsonValue;
};

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function planDates(p: PlanRow) {
  const care = parseGoals(p.goals).clinicalDetails;
  const dur = expectedDurationDays(care?.expectedDuration);
  const startDay = day(p.clinicianSignedAt ?? p.createdAt)!;
  return {
    reviewDue: day(p.reviewDueAt),
    planEnd: dur ? addCalendarDays(startDay, dur - 1) : null,
    serviceFrequency: care?.serviceFrequency ?? null,
    expectedDuration: care?.expectedDuration ?? null,
    levelOfCare: care?.levelOfCare || null,
  };
}

/** Newest active plan per client */
async function loadPlans(organizationId: string, clientIds: string[]) {
  const rows = (await prisma.treatmentPlan.findMany({
    where: { organizationId, clientId: { in: clientIds }, status: { in: ['ACTIVE', 'NEEDS_REVIEW'] } },
    select: { id: true, clientId: true, title: true, reviewDueAt: true, createdAt: true, clinicianSignedAt: true, diagnosisCodes: true, goals: true },
    orderBy: { createdAt: 'desc' },
  })) as PlanRow[];
  const byClient = new Map<string, PlanRow>();
  for (const r of rows) if (!byClient.has(r.clientId)) byClient.set(r.clientId, r);
  return byClient;
}

async function loadEvidence(organizationId: string, clientIds: string[], since: Date, now: Date) {
  const [appointments, notes, charges] = await Promise.all([
    prisma.appointment.findMany({
      where: { clientId: { in: clientIds }, startsAt: { gte: since, lte: new Date(now.getTime() + 400 * DAY_MS) } },
      select: { id: true, clientId: true, type: true, notes: true, status: true, startsAt: true, claims: { select: { cptCode: true } } },
    }),
    prisma.progressNote.findMany({
      where: {
        clientId: { in: clientIds },
        cptCode: { not: null },
        workflow: { status: { in: ['SIGNED', 'LOCKED'] } },
        OR: [{ dateOfService: { gte: since } }, { dateOfService: null, createdAt: { gte: since } }],
      },
      select: { clientId: true, cptCode: true, dateOfService: true, createdAt: true },
    }),
    prisma.valantTransaction.findMany({
      where: { organizationId, clientId: { in: clientIds }, category: 'charge', codeBase: { not: null }, serviceDate: { gte: since } },
      select: { clientId: true, serviceDate: true, codeBase: true, billingId: true, amountCents: true },
    }),
  ]);
  // Linear grouping (copying the client's array on every row was O(rows^2) per client)
  const group = <T extends { clientId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      if (!r.clientId) continue;
      const list = m.get(r.clientId);
      if (list) list.push(r);
      else m.set(r.clientId, [r]);
    }
    return m;
  };
  const apptsBy = group(appointments);
  const notesBy = group(notes);
  const chargesBy = group(charges);
  const out = new Map<string, ReturnType<typeof assembleClientEvidence>>();
  for (const id of clientIds) {
    const appts: AppointmentRow[] = (apptsBy.get(id) ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      notes: a.notes,
      status: a.status,
      startsAt: a.startsAt,
      claimCpts: a.claims.map((c) => c.cptCode).filter(Boolean),
    }));
    out.set(id, assembleClientEvidence({ appointments: appts, notes: (notesBy.get(id) ?? []) as NoteRow[], charges: (chargesBy.get(id) ?? []) as ChargeRow[] }, now));
  }
  return out;
}

function forecastFor(
  auth: ForecastAuthInput,
  ev: ReturnType<typeof assembleClientEvidence> | undefined,
  plan: PlanRow | undefined,
  now: Date
): AuthForecast {
  const types = authServiceTypes(auth.cptCodes);
  const attendedDays = (ev?.evidence ?? []).filter((e) => e.at <= now && visitMatchesAuth(e.serviceType, types)).map((e) => dayOf(e.at));
  const scheduledDays = (ev?.scheduled ?? []).filter((s) => visitMatchesAuth(s.serviceType, types, { scheduled: true })).map((s) => dayOf(s.at));
  const pd = plan ? planDates(plan) : null;
  return computeAuthForecast({
    auth,
    visits: { attendedDays, scheduledDays },
    plan: pd ? { reviewDue: pd.reviewDue, planEnd: pd.planEnd } : null,
    lead: renewalLeadTime(auth.payer, leadTimeConfigFromEnv(process.env)),
    now,
  });
}

async function forecastRows(organizationId: string, auths: ForecastAuthInput[], now: Date) {
  if (!auths.length) return [];
  const clientIds = [...new Set(auths.map((a) => a.clientId))];
  const earliest = Math.min(...auths.map((a) => (a.startDate ?? new Date(now.getTime() - 56 * DAY_MS)).getTime()));
  const since = new Date(Math.max(earliest, now.getTime() - ATTENDANCE_LOOKBACK_DAYS * DAY_MS) - DAY_MS);
  const [evidence, plans] = await Promise.all([loadEvidence(organizationId, clientIds, since, now), loadPlans(organizationId, clientIds)]);
  return sortForecasts(auths.map((a) => forecastFor(a, evidence.get(a.clientId), plans.get(a.clientId), now)));
}

const openAuthWhere = (now: Date): Prisma.PriorAuthWhereInput => ({
  status: 'APPROVED',
  OR: [{ endDate: null }, { endDate: { gte: new Date(now.getTime() - EXPIRED_LOOKBACK_DAYS * DAY_MS) } }],
});

/** Forecasts for the actor's accessible clients (caseload roles: own clients only) */
/** Whole-scope forecasts per viewer (org + user + role) for 60s: shared by the inbox and the authorizations page */
const forecastCache = new TtlCache<{ forecasts: AuthForecast[]; summary: AuthForecastSummary }>(60_000, 500);
/** Org-wide at-risk count (a number, no rows) for the billing overview, 2 minutes */
const atRiskCountCache = new TtlCache<number>(120_000, 200);

export async function loadAuthForecasts(
  actor: ForecastActor,
  opts: { clientId?: string; priorAuthIds?: string[]; fresh?: boolean } = {},
  now = new Date()
): Promise<{ forecasts: AuthForecast[]; summary: AuthForecastSummary }> {
  if (!opts.clientId && !opts.priorAuthIds) {
    const key = scopedKey({ organizationId: actor.organizationId, userId: actor.actorUserId, role: String(actor.actorRole) }, 'auth-forecast');
    return forecastCache.getOrCompute(key, () => loadAuthForecastsUncached(actor, {}, now), { fresh: opts.fresh });
  }
  return loadAuthForecastsUncached(actor, opts, now);
}

async function loadAuthForecastsUncached(
  actor: ForecastActor,
  opts: { clientId?: string; priorAuthIds?: string[] },
  now: Date
): Promise<{ forecasts: AuthForecast[]; summary: AuthForecastSummary }> {
  const auths = await prisma.priorAuth.findMany({
    where: {
      organizationId: actor.organizationId,
      ...openAuthWhere(now),
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
      ...(opts.priorAuthIds ? { id: { in: opts.priorAuthIds } } : {}),
      client: clientAccessWhere(actor),
    },
    select: AUTH_SELECT,
    take: 1000,
  });
  const forecasts = await forecastRows(actor.organizationId, auths, now);
  return { forecasts, summary: summarizeForecasts(forecasts) };
}

/** Org-wide count for the billing overview work queue (counts only) */
export async function countAtRiskAuthorizations(organizationId: string, now = new Date()): Promise<number> {
  return atRiskCountCache.getOrCompute(`org:${organizationId}`, () => countAtRiskAuthorizationsUncached(organizationId, now));
}

async function countAtRiskAuthorizationsUncached(organizationId: string, now: Date): Promise<number> {
  const auths = await prisma.priorAuth.findMany({
    where: { organizationId, ...openAuthWhere(now), client: clientOrgFilter(organizationId) },
    select: AUTH_SELECT,
    take: 1000,
  });
  const forecasts = await forecastRows(organizationId, auths, now);
  return forecasts.filter((f) => f.atRisk).length;
}

/** Everything the renewal packet needs for one auth, or null when not in scope */
export async function loadRenewalFacts(actor: ForecastActor, priorAuthId: string, now = new Date()): Promise<RenewalFacts | null> {
  const auth = await prisma.priorAuth.findFirst({
    where: { id: priorAuthId, organizationId: actor.organizationId, status: 'APPROVED', client: clientAccessWhere(actor) },
    select: {
      ...AUTH_SELECT,
      diagnosisCodes: true,
      client: { select: { id: true, name: true, dateOfBirth: true, insuranceMemberId: true, mrn: true, primaryDiagnosis: true, primaryDiagnosisCode: true, secondaryDiagnoses: true } },
    },
  });
  if (!auth) return null;
  const [forecast] = await forecastRows(actor.organizationId, [auth], now);
  const plans = await loadPlans(actor.organizationId, [auth.clientId]);
  const plan = plans.get(auth.clientId);
  const pd = plan ? planDates(plan) : null;

  const windowStart = auth.startDate ?? new Date(now.getTime() - 90 * DAY_MS);
  const notes = await prisma.progressNote.findMany({
    where: {
      clientId: auth.clientId,
      workflow: { status: { in: ['SIGNED', 'LOCKED'] } },
      OR: [{ dateOfService: { gte: windowStart } }, { dateOfService: null, createdAt: { gte: windowStart } }],
    },
    select: { body: true, dateOfService: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });

  const goals = plan ? parseGoals(plan.goals).items.map((g) => ({ text: g.text, progress: g.progress })) : [];
  const c = auth.client;
  const diagnoses = [
    ...new Set(
      [
        ...auth.diagnosisCodes,
        ...(plan?.diagnosisCodes ?? []),
        c.primaryDiagnosisCode ? `${c.primaryDiagnosisCode}${c.primaryDiagnosis ? ` ${c.primaryDiagnosis}` : ''}` : c.primaryDiagnosis,
        ...(c.secondaryDiagnoses ?? '').split(/[;\n]/),
      ]
        .map((d) => (d ?? '').trim())
        .filter(Boolean)
    ),
  ].slice(0, 12);

  return {
    forecast,
    request: renewalRequest(forecast, pd ? { serviceFrequency: pd.serviceFrequency, expectedDuration: pd.expectedDuration } : null),
    client: { name: c.name, dateOfBirth: day(c.dateOfBirth), memberId: c.insuranceMemberId, mrn: c.mrn, clientId: c.id },
    diagnoses,
    plan: plan ? { title: plan.title, reviewDue: pd?.reviewDue ?? null, levelOfCare: pd?.levelOfCare ?? null } : null,
    goals: summarizeGoals(goals, notes.slice(0, 10).map((n) => ({ body: n.body, day: day(n.dateOfService ?? n.createdAt)! }))),
    signedNotesInWindow: notes.length,
  };
}
