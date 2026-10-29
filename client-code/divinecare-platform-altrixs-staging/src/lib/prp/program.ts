/**
 * PRP hub server layer: scoping, loading and writes for enrollments, groups, attendance
 * (encounters) and MORS ratings. Every query is filtered by organizationId; participant data
 * is further limited to the actor's caseload (assigned PRP specialist, or clients the actor
 * may open per clientAccessWhere), minus protected records the actor cannot open.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import {
  irpFromWorkflow,
  monthBounds,
  parseServiceDate,
  planAttendanceWrites,
  PRP_ENROLLMENT_STATUSES,
  type AttendanceEntry,
  type RecordAttendanceInput,
  type AttendanceRow,
  type EnrollmentRow,
  type GroupRow,
  type IrpSummary,
  type MorsRow,
  type PrpEnrollmentStatus,
} from './reports';
import { defaultLocation, dischargeIssues, isPrpAuth, prpAuthSummary, type PrpAuthSummary } from './standard';
import { leadTimeConfigFromEnv, renewalLeadTime } from '@/lib/ai/authForecast/forecast';
import { ageOn } from '@/lib/ehr/psychMedMgmt';
import { clinicDate } from '@/lib/workflows/dates';

export const PRP_PATH = '/dashboard/prp';

/** Record attendance, manage groups, rate MORS. */
export const PRP_WRITE_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PRP_SPECIALIST']);
/** Change enrollment status / discharge (same set that may enroll). */
export const PRP_STATUS_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST']);

export type PrpActor = { organizationId: string; actorUserId: string; actorRole: Role; actorName?: string | null };

export class PrpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PrpError';
  }
}

// ─── Scoping ────────────────────────────────────────────────────────────────

/** Enrollment filter for this actor: org + (assigned PRP specialist OR client in the actor's caseload). */
export function enrollmentScopeWhere(actor: PrpActor) {
  return {
    organizationId: actor.organizationId,
    OR: [{ specialistId: actor.actorUserId }, { client: clientAccessWhere(actor) }],
  };
}

async function dropLocked<T extends { clientId: string }>(actor: PrpActor, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const locked = await lockedSensitiveClientIds({
    organizationId: actor.organizationId,
    userId: actor.actorUserId,
    role: actor.actorRole,
    clientIds: rows.map((r) => r.clientId),
  });
  return rows.filter((r) => !locked.has(r.clientId));
}

export async function loadEnrollments(actor: PrpActor): Promise<EnrollmentRow[]> {
  const rows = await prisma.prpEnrollment.findMany({
    where: enrollmentScopeWhere(actor),
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: { client: { select: { name: true } } },
  });
  const specialistIds = [...new Set(rows.map((r) => r.specialistId).filter((v): v is string => !!v))];
  const specialists = specialistIds.length
    ? await prisma.user.findMany({
        where: { id: { in: specialistIds }, organizationId: actor.organizationId },
        select: { id: true, name: true, email: true },
      })
    : [];
  const names = new Map(specialists.map((s) => [s.id, s.name || s.email]));
  const mapped: EnrollmentRow[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.client.name,
    displayId: r.displayId,
    status: r.status,
    startDate: r.startDate,
    createdAt: r.createdAt,
    statusChangedAt: r.statusChangedAt,
    dischargedAt: r.dischargedAt,
    dischargeReason: r.dischargeReason,
    specialistId: r.specialistId,
    specialistName: r.specialistId ? names.get(r.specialistId) ?? null : null,
    diagnosisCode: r.diagnosisCode,
    dischargeType: r.dischargeType,
    transitionPlan: r.transitionPlan,
    aftercarePlan: r.aftercarePlan,
  }));
  return dropLocked(actor, mapped);
}

export async function loadAttendance(
  actor: PrpActor,
  enrollmentIds: string[],
  range?: { start: Date; end: Date },
): Promise<AttendanceRow[]> {
  if (!enrollmentIds.length) return [];
  return prisma.prpAttendance.findMany({
    where: {
      organizationId: actor.organizationId,
      enrollmentId: { in: enrollmentIds },
      ...(range ? { serviceDate: { gte: range.start, lt: range.end } } : {}),
    },
    orderBy: { serviceDate: 'asc' },
    select: {
      id: true, enrollmentId: true, clientId: true, groupId: true, serviceDate: true, minutes: true, serviceType: true, billable: true,
      location: true, irpGoal: true, intervention: true, response: true, recordedById: true, recordedByName: true,
    },
  });
}

/**
 * PRP authorizations (Carelon) for enrollments already in scope: the enrollment's linked PriorAuth,
 * else the client's latest auth carrying a PRP code. Renewal lead time = authForecast renewalLeadTime
 * (clinic default for PBHS, not yet verified against the Carelon manual).
 */
export async function loadPrpAuths(actor: PrpActor, enrollments: { id: string; clientId: string }[], now = new Date()): Promise<Map<string, PrpAuthSummary>> {
  const out = new Map<string, PrpAuthSummary>();
  if (!enrollments.length) return out;
  const links = await prisma.prpEnrollment.findMany({
    where: { organizationId: actor.organizationId, id: { in: enrollments.map((e) => e.id) } },
    select: { id: true, priorAuthId: true },
  });
  const linked = new Map(links.map((l) => [l.id, l.priorAuthId]));
  const auths = await prisma.priorAuth.findMany({
    where: { organizationId: actor.organizationId, clientId: { in: [...new Set(enrollments.map((e) => e.clientId))] } },
    orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
    take: 2000,
    select: { id: true, clientId: true, authNumber: true, status: true, payer: true, startDate: true, endDate: true, unitsApproved: true, unitsUsed: true, cptCodes: true, notes: true },
  });
  const cfg = leadTimeConfigFromEnv(process.env);
  for (const e of enrollments) {
    const own = auths.filter((a) => a.clientId === e.clientId);
    const pick = own.find((a) => a.id === linked.get(e.id)) ?? own.find((a) => isPrpAuth(a));
    if (pick) out.set(e.id, prpAuthSummary(pick, now, renewalLeadTime(pick.payer, cfg).days));
  }
  return out;
}

export async function loadGroups(actor: PrpActor, includeInactive = true) {
  return prisma.prpGroup.findMany({
    where: { organizationId: actor.organizationId, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });
}

/** Age today (years) for clients already in scope; null when no DOB is on file. */
export async function loadClientAges(actor: PrpActor, clientIds: string[]): Promise<Map<string, number | null>> {
  if (!clientIds.length) return new Map();
  const rows = await prisma.client.findMany({
    where: { id: { in: clientIds }, organizationId: actor.organizationId },
    select: { id: true, dateOfBirth: true },
  });
  const today = clinicDate();
  return new Map(rows.map((r) => [r.id, ageOn(r.dateOfBirth ? r.dateOfBirth.toISOString() : null, today)]));
}

/** PrpWorkflow has no organizationId: only read rows for clients already in scope. */
export async function loadIrps(clientIds: string[]): Promise<Map<string, IrpSummary>> {
  if (!clientIds.length) return new Map();
  const rows = await prisma.prpWorkflow.findMany({
    where: { clientId: { in: clientIds } },
    orderBy: { updatedAt: 'desc' },
    select: { clientId: true, irpData: true, irpEffectiveDate: true, irpReviewDueDate: true, recommendedDomains: true },
  });
  const out = new Map<string, IrpSummary>();
  for (const r of rows) if (!out.has(r.clientId)) out.set(r.clientId, irpFromWorkflow(r));
  return out;
}

export async function loadMors(actor: PrpActor, enrollmentIds: string[], month?: string): Promise<MorsRow[]> {
  if (!enrollmentIds.length) return [];
  return prisma.prpMorsRating.findMany({
    where: { organizationId: actor.organizationId, enrollmentId: { in: enrollmentIds }, ...(month ? { month } : {}) },
    select: { enrollmentId: true, month: true, rating: true },
  });
}

/** Referrals in the org that have no enrollment yet (pipeline). Name only for caseload-scoped actors' visible ones. */
export async function loadReferralPipeline(actor: PrpActor) {
  const referrals = await prisma.prpReferral.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { referralDate: 'desc' },
    take: 300,
    select: { id: true, displayId: true, clientId: true, clientName: true, diagnosisCode: true, referralDate: true, prescriberName: true },
  });
  const enrolled = new Set(
    (
      await prisma.prpEnrollment.findMany({
        where: { organizationId: actor.organizationId, referralId: { in: referrals.map((r) => r.id) } },
        select: { referralId: true },
      })
    ).map((e) => e.referralId),
  );
  const pending = referrals.filter((r) => !enrolled.has(r.id));
  // Referrals linked to a chart are subject to the same protected-record rule.
  const linked = pending.filter((r): r is typeof r & { clientId: string } => !!r.clientId);
  const locked = linked.length
    ? await lockedSensitiveClientIds({
        organizationId: actor.organizationId,
        userId: actor.actorUserId,
        role: actor.actorRole,
        clientIds: linked.map((r) => r.clientId),
      })
    : new Set<string>();
  return pending.filter((r) => !r.clientId || !locked.has(r.clientId));
}

async function requireEnrollment(actor: PrpActor, enrollmentId: string) {
  const e = await prisma.prpEnrollment.findFirst({
    where: { AND: [{ id: enrollmentId }, enrollmentScopeWhere(actor)] },
    select: { id: true, clientId: true, status: true },
  });
  if (!e) throw new PrpError('Enrollment not found in your caseload', 404);
  const [kept] = await dropLocked(actor, [e]);
  if (!kept) throw new PrpError('Protected record: break-glass access is required', 403);
  return e;
}

// ─── Groups ─────────────────────────────────────────────────────────────────

export type GroupInput = {
  name: string;
  schedule?: string | null;
  facilitatorId?: string | null;
  location?: string | null;
  active?: boolean;
};

async function facilitatorName(actor: PrpActor, facilitatorId: string | null | undefined) {
  if (!facilitatorId) return null;
  const u = await prisma.user.findFirst({
    where: { id: facilitatorId, organizationId: actor.organizationId },
    select: { name: true, email: true },
  });
  if (!u) throw new PrpError('Facilitator not found in your organization', 400);
  return u.name || u.email;
}

export async function createGroup(actor: PrpActor, input: GroupInput) {
  return prisma.prpGroup.create({
    data: {
      organizationId: actor.organizationId,
      name: input.name,
      schedule: input.schedule || null,
      facilitatorId: input.facilitatorId || null,
      facilitatorName: await facilitatorName(actor, input.facilitatorId),
      location: input.location || null,
      active: input.active ?? true,
      createdById: actor.actorUserId,
    },
  });
}

export async function updateGroup(actor: PrpActor, id: string, input: Partial<GroupInput>) {
  const existing = await prisma.prpGroup.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!existing) throw new PrpError('Group not found', 404);
  return prisma.prpGroup.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.schedule !== undefined ? { schedule: input.schedule || null } : {}),
      ...(input.location !== undefined ? { location: input.location || null } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.facilitatorId !== undefined
        ? { facilitatorId: input.facilitatorId || null, facilitatorName: await facilitatorName(actor, input.facilitatorId) }
        : {}),
    },
  });
}

// ─── Attendance ─────────────────────────────────────────────────────────────

export type { AttendanceEntry, RecordAttendanceInput } from './reports';

export async function recordAttendance(actor: PrpActor, input: RecordAttendanceInput) {
  const serviceDate = parseServiceDate(input.serviceDate);
  if (!serviceDate) throw new PrpError('Service date must be a valid date (YYYY-MM-DD)', 400);
  const today = new Date();
  if (serviceDate.getTime() > Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1)) {
    throw new PrpError('Attendance cannot be recorded for a future date', 400);
  }
  if (input.serviceType === 'group' && !input.groupId) throw new PrpError('Choose the group for a group session', 400);
  if (input.groupId) {
    const g = await prisma.prpGroup.findFirst({ where: { id: input.groupId, organizationId: actor.organizationId }, select: { id: true } });
    if (!g) throw new PrpError('Group not found', 404);
  }
  const ids = [...new Set(input.entries.map((e) => e.enrollmentId))];
  if (ids.length !== input.entries.length) throw new PrpError('Each participant may appear once per submission', 400);
  const enrollments = new Map<string, { id: string; clientId: string }>();
  for (const id of ids) enrollments.set(id, await requireEnrollment(actor, id));

  const existing =
    input.serviceType === 'group'
      ? await prisma.prpAttendance.findMany({
          where: { organizationId: actor.organizationId, groupId: input.groupId!, serviceDate, enrollmentId: { in: ids } },
          select: { id: true, enrollmentId: true },
        })
      : [];
  const plan = planAttendanceWrites(input, existing);
  const minutesFor = (e: AttendanceEntry) => (e.minutes !== undefined ? e.minutes : input.minutes ?? null);
  // Encounter documentation: entry value, else the session value; location defaults from the service type.
  const docFor = (e: AttendanceEntry) => ({
    location: e.location || input.location || defaultLocation(input.serviceType),
    irpGoal: e.irpGoal?.trim() || null,
    intervention: e.intervention?.trim() || input.intervention?.trim() || null,
    response: e.response?.trim() || null,
  });

  await prisma.$transaction([
    ...plan.creates.map((e) =>
      prisma.prpAttendance.create({
        data: {
          organizationId: actor.organizationId,
          clientId: enrollments.get(e.enrollmentId)!.clientId,
          enrollmentId: e.enrollmentId,
          groupId: input.groupId || null,
          serviceDate,
          minutes: minutesFor(e),
          serviceType: input.serviceType,
          billable: e.billable ?? true,
          note: e.note || null,
          ...docFor(e),
          recordedById: actor.actorUserId,
          recordedByName: actor.actorName ?? null,
        },
      }),
    ),
    ...plan.updates.map((e) =>
      prisma.prpAttendance.update({
        where: { id: e.id },
        data: { minutes: minutesFor(e), billable: e.billable ?? true, note: e.note || null, ...docFor(e), recordedById: actor.actorUserId, recordedByName: actor.actorName ?? null },
      }),
    ),
    ...(plan.deletes.length ? [prisma.prpAttendance.deleteMany({ where: { id: { in: plan.deletes }, organizationId: actor.organizationId } })] : []),
  ]);
  return {
    created: plan.creates.length,
    updated: plan.updates.length,
    removed: plan.deletes.length,
    clientIds: [...new Set([...enrollments.values()].map((e) => e.clientId))],
  };
}

export async function deleteAttendance(actor: PrpActor, id: string) {
  const row = await prisma.prpAttendance.findFirst({ where: { id, organizationId: actor.organizationId }, select: { id: true, enrollmentId: true, clientId: true } });
  if (!row) throw new PrpError('Attendance entry not found', 404);
  await requireEnrollment(actor, row.enrollmentId);
  await prisma.prpAttendance.delete({ where: { id } });
  return row;
}

/** Roster check-off state for one group + date (scoped enrollments only). */
export async function rosterFor(actor: PrpActor, groupId: string, date: string) {
  const serviceDate = parseServiceDate(date);
  if (!serviceDate) throw new PrpError('Invalid date', 400);
  const enrollments = (await loadEnrollments(actor)).filter((e) => e.status === 'active' || e.status === 'transitioning');
  const rows = await prisma.prpAttendance.findMany({
    where: { organizationId: actor.organizationId, groupId, serviceDate, enrollmentId: { in: enrollments.map((e) => e.id) } },
    select: { id: true, enrollmentId: true, minutes: true, billable: true, note: true, location: true, irpGoal: true, intervention: true, response: true },
  });
  return { enrollments, rows };
}

// ─── Enrollment status & MORS ───────────────────────────────────────────────

export async function updateEnrollmentStatus(
  actor: PrpActor,
  id: string,
  input: {
    status?: PrpEnrollmentStatus;
    dischargeReason?: string | null;
    dischargeType?: string | null;
    transitionPlan?: string | null;
    aftercarePlan?: string | null;
    specialistId?: string | null;
  },
) {
  const e = await requireEnrollment(actor, id);
  if (input.status && !(PRP_ENROLLMENT_STATUSES as readonly string[]).includes(input.status)) throw new PrpError('Invalid status', 400);
  if (input.status === 'discharged' && !input.dischargeReason?.trim()) throw new PrpError('A discharge reason is required', 400);
  const missing = input.status && input.status !== e.status ? dischargeIssues(input) : [];
  if (missing.length) throw new PrpError(`Required for this status: ${missing.join(', ')}`, 400);
  if (input.specialistId) {
    const s = await prisma.user.findFirst({ where: { id: input.specialistId, organizationId: actor.organizationId }, select: { id: true } });
    if (!s) throw new PrpError('Specialist not found in your organization', 400);
  }
  const now = new Date();
  const changed = input.status && input.status !== e.status;
  return prisma.prpEnrollment.update({
    where: { id },
    data: {
      ...(changed ? { status: input.status, statusChangedAt: now } : {}),
      ...(changed && input.status === 'discharged'
        ? {
            dischargedAt: now,
            dischargeReason: input.dischargeReason!.trim(),
            dischargeType: input.dischargeType ?? null,
            aftercarePlan: input.aftercarePlan?.trim() || null,
            dischargedById: actor.actorUserId,
          }
        : {}),
      ...(changed && input.status !== 'discharged' ? { dischargedAt: null, dischargeReason: null, dischargeType: null, aftercarePlan: null, dischargedById: null } : {}),
      // The transition plan is kept through discharge (it is part of the discharge record).
      ...(input.transitionPlan !== undefined && input.transitionPlan !== null && input.transitionPlan.trim()
        ? { transitionPlan: input.transitionPlan.trim() }
        : {}),
      ...(input.specialistId !== undefined ? { specialistId: input.specialistId || null } : {}),
    },
  });
}

export async function rateMors(actor: PrpActor, input: { enrollmentId: string; month: string; rating: number; note?: string | null }) {
  const e = await requireEnrollment(actor, input.enrollmentId);
  const { start } = monthBounds(input.month);
  if (start.getTime() > Date.now()) throw new PrpError('MORS cannot be rated for a future month', 400);
  return prisma.prpMorsRating.upsert({
    where: { enrollmentId_month: { enrollmentId: e.id, month: input.month } },
    create: {
      organizationId: actor.organizationId,
      clientId: e.clientId,
      enrollmentId: e.id,
      month: input.month,
      rating: input.rating,
      note: input.note || null,
      ratedById: actor.actorUserId,
      ratedByName: actor.actorName ?? null,
    },
    update: { rating: input.rating, note: input.note || null, ratedById: actor.actorUserId, ratedByName: actor.actorName ?? null },
  });
}

export type { GroupRow };
