/**
 * Intensive programs server layer (IOP / PHP): programs, referral -> admission, daily attendance,
 * missed-day outreach, weekly review, discharge, charge drafts and the hub. Every query is
 * filtered by organizationId; enrollments are narrowed to the viewer (src/lib/intensive/access.ts:
 * leadership org-wide, others program team or caseload via clientAccessWhere, Part 2 rule for
 * SUD programs) minus protected records the viewer cannot open (lockedSensitiveClientIds).
 */
import type { IntensiveEnrollment, IntensiveProgram, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { consentOnFile, type ConsentRowForCheck } from '@/lib/consents/onFile';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { practiceToday } from '@/lib/time/practiceTime';
import { parseAsamScores } from '@/lib/residential/asamScores';
import { GAD7, PHQ9 } from '@/lib/reports/outcomesReports';
import {
  canGenerateCharges,
  canMakeClinicalDecisions,
  canManagePrograms,
  canReadCharges,
  canRecordProgramWork,
  canSeeEnrollment,
  canSeePart2ProgramList,
  canSeeRollups,
  isIntensiveLeadership,
} from './access';
import {
  billingModeOf,
  effectivePolicy,
  parseSchedule,
  parseServiceCodes,
  parseUnitRules,
  perDiemCodeOf,
  policyValues,
  programActivationProblem,
  programIsPart2,
  scheduleMinutes,
  scheduleWarnings,
  defaultActive,
} from './policy';
import {
  addDays,
  admissionReadiness,
  attendedMinutes,
  authStatus,
  dayDate,
  dischargeProblems,
  draftsForDay,
  followUpDueAt,
  followUpExpected,
  followUpStatus,
  isoDay,
  missedDayNeedsFollowUp,
  outcomeSummary,
  pairScores,
  planTimeline,
  programDaysInWeek,
  suppressedRate,
  unitsPerWeek,
  weekCompliance,
  weekStartOf,
  weeklyHours,
  weeklyReviewStatus,
  type AuthStatus,
  type DraftAttendance,
} from './rules';
import {
  CONSENT_KEYS,
  PROGRAM_TYPE_META,
  isAttendedStatus,
  isProgramType,
  type AttendanceStatus,
  type OutreachAttempt,
  type OutreachMethod,
  type ProgramType,
  type ScheduleTemplate,
  type SessionType,
} from './types';

export type IntensiveActor = { organizationId: string; userId: string; role: Role; name: string | null; medicalDirector: boolean };

export class IntensiveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'IntensiveError';
  }
}

type ProgramRow = IntensiveProgram;
type EnrollmentRow = IntensiveEnrollment;

const typeOf = (p: { programType: string }): ProgramType => (isProgramType(p.programType) ? p.programType : 'MH_IOP');

// ─── Programs ───────────────────────────────────────────────────────────────

export function programView(p: ProgramRow, locationName: string | null) {
  const type = typeOf(p);
  const schedule = parseSchedule(p.scheduleTemplate, type);
  const policy = effectivePolicy(p);
  return {
    id: p.id,
    name: p.name,
    locationId: p.locationId,
    locationName,
    programType: type,
    typeLabel: PROGRAM_TYPE_META[type].label,
    level: PROGRAM_TYPE_META[type].level,
    asamLevel: PROGRAM_TYPE_META[type].asamLevel,
    ageGroup: p.ageGroup === 'adolescent' ? 'adolescent' : 'adult',
    active: p.active,
    phpLicensureConfirmed: p.phpLicensureConfirmed,
    part2: p.part2,
    schedule,
    scheduleMinutes: scheduleMinutes(schedule),
    policy,
    policyConfirmed: p.policyConfirmedAt ? { at: p.policyConfirmedAt.toISOString(), by: p.policyConfirmedByName } : null,
    billingMode: billingModeOf(p.billingMode),
    perDiemCode: perDiemCodeOf(p),
    perDiemIsDefault: !p.perDiemCode,
    serviceCodes: parseServiceCodes(p.serviceCodes, type),
    serviceCodesIsDefault: !p.serviceCodes,
    unitRules: parseUnitRules(p.unitRules, type),
    unitRulesIsDefault: !p.unitRules,
    linkedGroupIds: p.linkedGroupIds,
    warnings: [
      ...scheduleWarnings(schedule, policy.minWeeklyHours.value),
      ...(type === 'PHP' && !p.phpLicensureConfirmed ? [PROGRAM_TYPE_META.PHP.note] : []),
    ],
  };
}
export type ProgramView = ReturnType<typeof programView>;

async function locationNames(organizationId: string, ids: (string | null)[]) {
  const want = [...new Set(ids.filter((v): v is string => !!v))];
  if (!want.length) return new Map<string, string>();
  const rows = await prisma.location.findMany({ where: { organizationId, id: { in: want } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function listPrograms(actor: IntensiveActor, opts: { includeInactive?: boolean } = {}): Promise<ProgramView[]> {
  const rows = await prisma.intensiveProgram.findMany({
    where: { organizationId: actor.organizationId, ...(opts.includeInactive ? {} : { active: true }) },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });
  // Part 2 programs are listed only to roles that may see Part 2 program records (or leadership)
  const visible = rows.filter((p) => !p.part2 || canSeePart2ProgramList(actor.role, actor.medicalDirector));
  const names = await locationNames(actor.organizationId, visible.map((p) => p.locationId));
  return visible.map((p) => programView(p, p.locationId ? names.get(p.locationId) ?? null : null));
}

export type ProgramInput = {
  name: string;
  locationId?: string | null;
  programType: ProgramType;
  ageGroup: 'adult' | 'adolescent';
  active?: boolean;
  phpLicensureConfirmed?: boolean;
  sudFocus?: boolean;
  schedule?: unknown;
  minWeeklyHours?: number | null;
  initialPlanDays?: number | null;
  planReviewDays?: number | null;
  authRenewalLeadDays?: number | null;
  followUpWindowDays?: number | null;
  missedDayOutreachHours?: number | null;
  billingMode?: 'per_diem' | 'per_service';
  perDiemCode?: string | null;
  serviceCodes?: unknown;
  unitRules?: unknown;
  linkedGroupIds?: string[];
};

async function checkLinkedGroups(actor: IntensiveActor, ids: string[], part2: boolean) {
  if (!ids.length) return;
  const groups = await prisma.clinicalGroup.findMany({ where: { organizationId: actor.organizationId, id: { in: ids } }, select: { id: true, kind: true } });
  if (groups.length !== new Set(ids).size) throw new IntensiveError('A linked group was not found', 400);
  // Keep Part 2 and non-Part 2 records apart: SUD programs link SUD groups only, and vice versa
  const bad = groups.filter((g) => (part2 ? g.kind !== 'sud' : g.kind === 'sud'));
  if (bad.length) {
    throw new IntensiveError(part2 ? 'A SUD (Part 2) program can link SUD groups only' : 'A mental health program cannot link SUD (Part 2) groups', 400);
  }
}

export async function saveProgram(actor: IntensiveActor, id: string | null, input: ProgramInput) {
  if (!canManagePrograms(actor.role)) throw new IntensiveError('Only practice leadership sets up programs', 403);
  const existing = id ? await prisma.intensiveProgram.findFirst({ where: { id, organizationId: actor.organizationId } }) : null;
  if (id && !existing) throw new IntensiveError('Program not found', 404);
  if (existing && existing.programType !== input.programType) {
    const used = await prisma.intensiveEnrollment.count({ where: { organizationId: actor.organizationId, programId: existing.id } });
    if (used) throw new IntensiveError('This program has enrollments; its type cannot change. Create a new program instead.', 400);
  }
  if (input.locationId) {
    const loc = await prisma.location.findFirst({ where: { id: input.locationId, organizationId: actor.organizationId }, select: { id: true } });
    if (!loc) throw new IntensiveError('Location not found in your organization', 400);
  }
  const type = input.programType;
  const php = input.phpLicensureConfirmed ?? existing?.phpLicensureConfirmed ?? false;
  const active = input.active ?? existing?.active ?? defaultActive(type);
  const activation = programActivationProblem(type, active, php);
  if (activation) throw new IntensiveError(activation, 400);
  const part2 = programIsPart2(type, input.sudFocus ?? existing?.part2 ?? false);
  const linked = input.linkedGroupIds ?? existing?.linkedGroupIds ?? [];
  await checkLinkedGroups(actor, linked, part2);

  const policyData = {
    minWeeklyHours: input.minWeeklyHours ?? null,
    initialPlanDays: input.initialPlanDays ?? null,
    planReviewDays: input.planReviewDays ?? null,
    authRenewalLeadDays: input.authRenewalLeadDays ?? null,
    followUpWindowDays: input.followUpWindowDays ?? null,
    missedDayOutreachHours: input.missedDayOutreachHours ?? null,
    billingMode: input.billingMode ?? 'per_diem',
    perDiemCode: input.perDiemCode?.trim().toUpperCase() || null,
    serviceCodes: input.serviceCodes === undefined || input.serviceCodes === null ? undefined : (parseServiceCodes(input.serviceCodes, type) as unknown as Prisma.InputJsonValue),
    unitRules: input.unitRules === undefined || input.unitRules === null ? undefined : (parseUnitRules(input.unitRules, type) as unknown as Prisma.InputJsonValue),
    scheduleTemplate: input.schedule === undefined ? undefined : (parseSchedule(input.schedule, type) as unknown as Prisma.InputJsonValue),
  };
  // Any policy / billing change needs leadership to confirm the program policy again
  const policyChanged =
    !existing ||
    (['minWeeklyHours', 'initialPlanDays', 'planReviewDays', 'authRenewalLeadDays', 'followUpWindowDays', 'missedDayOutreachHours', 'billingMode', 'perDiemCode'] as const).some(
      (k) => (existing as Record<string, unknown>)[k] !== (policyData as Record<string, unknown>)[k],
    ) ||
    (policyData.serviceCodes !== undefined && JSON.stringify(existing.serviceCodes) !== JSON.stringify(policyData.serviceCodes)) ||
    (policyData.unitRules !== undefined && JSON.stringify(existing.unitRules) !== JSON.stringify(policyData.unitRules)) ||
    (policyData.scheduleTemplate !== undefined && JSON.stringify(existing.scheduleTemplate) !== JSON.stringify(policyData.scheduleTemplate));

  const data = {
    name: input.name.trim(),
    locationId: input.locationId || null,
    programType: type,
    ageGroup: input.ageGroup,
    active,
    phpLicensureConfirmed: php,
    part2,
    linkedGroupIds: linked,
    ...policyData,
    ...(policyChanged ? { policyConfirmedAt: null, policyConfirmedById: null, policyConfirmedByName: null } : {}),
  };
  const row = existing
    ? await prisma.intensiveProgram.update({ where: { id: existing.id }, data })
    : await prisma.intensiveProgram.create({ data: { ...data, organizationId: actor.organizationId, createdById: actor.userId } });
  return { program: row, policyReset: Boolean(existing) && policyChanged };
}

export async function confirmProgramPolicy(actor: IntensiveActor, id: string) {
  if (!canManagePrograms(actor.role)) throw new IntensiveError('Only practice leadership confirms program policy', 403);
  const p = await prisma.intensiveProgram.findFirst({ where: { id, organizationId: actor.organizationId }, select: { id: true } });
  if (!p) throw new IntensiveError('Program not found', 404);
  return prisma.intensiveProgram.update({
    where: { id },
    data: { policyConfirmedAt: new Date(), policyConfirmedById: actor.userId, policyConfirmedByName: actor.name },
  });
}

async function requireProgram(actor: IntensiveActor, id: string) {
  const p = await prisma.intensiveProgram.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!p) throw new IntensiveError('Program not found', 404);
  if (p.part2 && !canSeePart2ProgramList(actor.role, actor.medicalDirector)) {
    throw new IntensiveError('42 CFR Part 2 program: not available for your role', 403);
  }
  return p;
}

// ─── Enrollment scope ───────────────────────────────────────────────────────

type ClientInfo = { id: string; name: string; mrn: string | null; dateOfBirth: Date | null };

/** Enrollments (matching `where`) this actor may see, with the client row. */
async function scopedEnrollments(actor: IntensiveActor, where: Prisma.IntensiveEnrollmentWhereInput, take = 2000) {
  const rows = await prisma.intensiveEnrollment.findMany({
    where: { organizationId: actor.organizationId, ...where },
    orderBy: [{ status: 'asc' }, { referralDate: 'desc' }],
    take,
  });
  if (!rows.length) return [] as Array<{ e: EnrollmentRow; client: ClientInfo }>;
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const leader = isIntensiveLeadership(actor.role, actor.medicalDirector);
  const [inOrg, inCaseload, locked] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: clientIds }, AND: [clientOrgFilter(actor.organizationId)] },
      select: { id: true, name: true, mrn: true, dateOfBirth: true },
    }),
    leader
      ? Promise.resolve([] as { id: string }[])
      : prisma.client.findMany({
          where: { id: { in: clientIds }, AND: [clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role })] },
          select: { id: true },
        }),
    lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientIds }),
  ]);
  const clients = new Map(inOrg.map((c) => [c.id, c]));
  const caseload = new Set(inCaseload.map((c) => c.id));
  const out: Array<{ e: EnrollmentRow; client: ClientInfo }> = [];
  for (const e of rows) {
    const client = clients.get(e.clientId);
    if (!client || locked.has(e.clientId)) continue;
    const ok = canSeeEnrollment({
      role: String(actor.role),
      userId: actor.userId,
      medicalDirector: actor.medicalDirector,
      part2: e.part2,
      team: e,
      inCaseload: caseload.has(e.clientId),
    });
    if (ok) out.push({ e, client });
  }
  return out;
}

async function requireEnrollment(actor: IntensiveActor, id: string) {
  const [hit] = await scopedEnrollments(actor, { id }, 1);
  if (!hit) throw new IntensiveError('Enrollment not found in your program caseload', 404);
  return hit;
}

async function staffNames(organizationId: string, ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter((v): v is string => !!v))];
  if (!want.length) return new Map<string, string>();
  const rows = await prisma.user.findMany({ where: { organizationId, id: { in: want } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

async function orgStaff(organizationId: string, id: string | null | undefined, roles?: string[]) {
  if (!id) return null;
  const u = await prisma.user.findFirst({ where: { id, organizationId }, select: { id: true, role: true } });
  if (!u) throw new IntensiveError('Staff member not found in your organization', 400);
  if (roles && !roles.includes(String(u.role))) throw new IntensiveError(`That staff member's role cannot fill this team slot`, 400);
  return u.id;
}

function ageYears(dob: Date | null, today: string): number | null {
  if (!dob) return null;
  const t = dayDate(today);
  let a = t.getUTCFullYear() - dob.getUTCFullYear();
  const m = t.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && t.getUTCDate() < dob.getUTCDate())) a -= 1;
  return a;
}

async function orgToday(organizationId: string) {
  const tz = await getPracticeTimeZone(organizationId);
  return practiceToday(tz);
}

// ─── Referral -> admission ──────────────────────────────────────────────────

export async function createReferral(
  actor: IntensiveActor,
  input: { programId: string; clientId: string; referralDate: string; referralSource?: string | null; referralReason?: string | null },
) {
  if (!canRecordProgramWork(actor.role)) throw new IntensiveError('Your role cannot add program referrals', 403);
  const program = await requireProgram(actor, input.programId);
  if (!program.active) throw new IntensiveError('This program is not active', 400);
  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      AND: [
        clientOrgFilter(actor.organizationId),
        ...(isIntensiveLeadership(actor.role, actor.medicalDirector) ? [] : [clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role })]),
      ],
    },
    select: { id: true },
  });
  if (!client) throw new IntensiveError('Client not found in your caseload', 404);
  const locked = await lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientIds: [client.id] });
  if (locked.has(client.id)) throw new IntensiveError('Protected record: break-glass access is required', 403);
  const open = await prisma.intensiveEnrollment.findFirst({
    where: { organizationId: actor.organizationId, clientId: client.id, status: { in: ['referred', 'screening', 'admitted'] } },
    select: { id: true },
  });
  if (open) throw new IntensiveError('The client already has an open intensive program episode', 409);
  return prisma.intensiveEnrollment.create({
    data: {
      organizationId: actor.organizationId,
      programId: program.id,
      clientId: client.id,
      status: 'referred',
      referralDate: dayDate(input.referralDate),
      referralSource: input.referralSource?.trim() || null,
      referralReason: input.referralReason?.trim() || null,
      part2: program.part2,
      createdById: actor.userId,
    },
  });
}

type Screening = {
  criteria?: Record<string, boolean>;
  criteriaOverride?: string | null;
  locusRecordId?: string | null;
  asamScores?: unknown;
  levelNote?: string | null;
  screenedAt?: string;
  screenedById?: string;
  screenedByName?: string | null;
};

function screeningOf(e: { screening: Prisma.JsonValue | null }): Screening {
  const s = e.screening;
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as Screening) : {};
}

export type AdmissionPatch = {
  screening?: { criteria: Record<string, boolean>; criteriaOverride?: string | null; locusRecordId?: string | null; asamScores?: unknown; levelNote?: string | null };
  priorAuthId?: string | null;
  newAuth?: { payer: string; authNumber?: string | null; unitsApproved: number; startDate: string; endDate: string; codes?: string[] } | null;
  psychEvalDate?: string | null;
  psychEvalNoteId?: string | null;
  admissionDate?: string | null;
  primaryClinicianId?: string | null;
  prescriberId?: string | null;
  caseManagerId?: string | null;
  treatmentPlanId?: string | null;
};

export async function updateAdmission(actor: IntensiveActor, id: string, patch: AdmissionPatch) {
  const { e } = await requireEnrollment(actor, id);
  if (!canMakeClinicalDecisions(actor.role) && (patch.screening || patch.admissionDate || patch.primaryClinicianId !== undefined || patch.prescriberId !== undefined)) {
    throw new IntensiveError('Screening, admission and team assignment are clinical decisions (licensed staff or leadership)', 403);
  }
  if (e.status === 'discharged' || e.status === 'declined') throw new IntensiveError('This episode is closed', 400);
  const program = await requireProgram(actor, e.programId);
  const data: Prisma.IntensiveEnrollmentUpdateInput = {};

  if (patch.screening) {
    let asam: unknown = null;
    if (patch.screening.asamScores !== undefined && patch.screening.asamScores !== null) {
      const parsed = parseAsamScores(patch.screening.asamScores);
      if (parsed.kind === 'invalid') throw new IntensiveError(`Rate all six ASAM dimensions 0-4 (missing ${parsed.missing.join(', ')})`, 400);
      asam = parsed.kind === 'ok' ? parsed.scores : null;
    }
    if (patch.screening.locusRecordId) {
      const locus = await prisma.locusAssessmentRecord.findFirst({
        where: { id: patch.screening.locusRecordId, organizationId: actor.organizationId, clientId: e.clientId },
        select: { id: true },
      });
      if (!locus) throw new IntensiveError('LOCUS record not found for this client', 400);
    }
    const s: Screening = {
      criteria: patch.screening.criteria,
      criteriaOverride: patch.screening.criteriaOverride?.trim() || null,
      locusRecordId: patch.screening.locusRecordId || null,
      asamScores: asam,
      levelNote: patch.screening.levelNote?.trim() || null,
      screenedAt: new Date().toISOString(),
      screenedById: actor.userId,
      screenedByName: actor.name,
    };
    data.screening = s as unknown as Prisma.InputJsonValue;
    if (e.status === 'referred') data.status = 'screening';
  }

  if (patch.newAuth) {
    const a = patch.newAuth;
    if (a.endDate < a.startDate) throw new IntensiveError('Authorization end date is before its start date', 400);
    const auth = await prisma.priorAuth.create({
      data: {
        organizationId: actor.organizationId,
        clientId: e.clientId,
        payer: a.payer.trim(),
        authNumber: a.authNumber?.trim() || null,
        cptCodes: a.codes?.length ? a.codes : [perDiemCodeOf(program)],
        unitsApproved: a.unitsApproved,
        status: 'APPROVED',
        startDate: dayDate(a.startDate),
        endDate: dayDate(a.endDate),
        notes: `Intensive program authorization (${program.name})`,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    data.priorAuthId = auth.id;
  } else if (patch.priorAuthId !== undefined) {
    if (patch.priorAuthId) {
      const auth = await prisma.priorAuth.findFirst({ where: { id: patch.priorAuthId, organizationId: actor.organizationId, clientId: e.clientId }, select: { id: true } });
      if (!auth) throw new IntensiveError('Authorization not found for this client', 400);
    }
    data.priorAuthId = patch.priorAuthId || null;
  }
  if (patch.psychEvalNoteId !== undefined) {
    if (patch.psychEvalNoteId) {
      const n = await prisma.progressNote.findFirst({ where: { id: patch.psychEvalNoteId, clientId: e.clientId }, select: { id: true } });
      if (!n) throw new IntensiveError('Psychiatric evaluation note not found for this client', 400);
    }
    data.psychEvalNoteId = patch.psychEvalNoteId || null;
  }
  if (patch.psychEvalDate !== undefined) data.psychEvalDate = patch.psychEvalDate ? dayDate(patch.psychEvalDate) : null;
  if (patch.admissionDate !== undefined) {
    if (patch.admissionDate && patch.admissionDate < isoDay(e.referralDate)) throw new IntensiveError('Admission date is before the referral date', 400);
    data.admissionDate = patch.admissionDate ? dayDate(patch.admissionDate) : null;
  }
  const CLIN = ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];
  if (patch.primaryClinicianId !== undefined) data.primaryClinicianId = await orgStaff(actor.organizationId, patch.primaryClinicianId, CLIN);
  if (patch.prescriberId !== undefined) data.prescriberId = await orgStaff(actor.organizationId, patch.prescriberId, ['PSYCHIATRIST', 'NP']);
  if (patch.caseManagerId !== undefined) data.caseManagerId = await orgStaff(actor.organizationId, patch.caseManagerId, ['CASE_MANAGER', ...CLIN]);
  if (patch.treatmentPlanId !== undefined) {
    if (patch.treatmentPlanId) {
      const tp = await prisma.treatmentPlan.findFirst({ where: { id: patch.treatmentPlanId, organizationId: actor.organizationId, clientId: e.clientId }, select: { id: true } });
      if (!tp) throw new IntensiveError('Treatment plan not found for this client', 400);
    }
    data.treatmentPlanId = patch.treatmentPlanId || null;
  }
  return prisma.intensiveEnrollment.update({ where: { id: e.id }, data });
}

async function consentKeysOnFile(organizationId: string, clientId: string, now: Date): Promise<Set<string>> {
  const rows: ConsentRowForCheck[] = await prisma.consentForm.findMany({
    where: { organizationId, clientId },
    select: { type: true, formKey: true, status: true, formStatus: true, expiresAt: true, revokedAt: true },
  });
  const out = new Set<string>();
  if (consentOnFile(rows, CONSENT_KEYS.treatment, /consent to treat|informed consent/i, now)) out.add(CONSENT_KEYS.treatment);
  if (consentOnFile(rows, CONSENT_KEYS.part2, /part 2|42 cfr/i, now)) out.add(CONSENT_KEYS.part2);
  if (consentOnFile(rows, CONSENT_KEYS.group, /group/i, now)) out.add(CONSENT_KEYS.group);
  if (consentOnFile(rows, CONSENT_KEYS.minor, /minor/i, now)) out.add(CONSENT_KEYS.minor);
  return out;
}

async function readinessFor(actor: IntensiveActor, e: EnrollmentRow, program: ProgramRow, client: ClientInfo, today: string) {
  const s = screeningOf(e);
  const consents = await consentKeysOnFile(actor.organizationId, e.clientId, new Date());
  const schedule = parseSchedule(program.scheduleTemplate, typeOf(program));
  return admissionReadiness({
    programType: typeOf(program),
    part2: e.part2,
    clientAgeYears: ageYears(client.dateOfBirth, today),
    criteria: s.criteria ?? {},
    criteriaOverride: s.criteriaOverride ?? null,
    levelOfCare: { locusRecordId: s.locusRecordId ?? null, asamComplete: Boolean(s.asamScores) },
    consentsOnFile: consents,
    hasAuthorization: Boolean(e.priorAuthId),
    psychEvalDate: e.psychEvalDate ? isoDay(e.psychEvalDate) : null,
    admissionDate: e.admissionDate ? isoDay(e.admissionDate) : null,
    primaryClinicianId: e.primaryClinicianId,
    prescriberId: e.prescriberId,
    caseManagerId: e.caseManagerId,
    usesGroups: schedule.blocks.some((b) => b.sessionType === 'group'),
  });
}

export async function admit(actor: IntensiveActor, id: string) {
  if (!canMakeClinicalDecisions(actor.role)) throw new IntensiveError('Admission is a clinical decision (licensed staff or leadership)', 403);
  const { e, client } = await requireEnrollment(actor, id);
  if (e.status === 'admitted') throw new IntensiveError('Already admitted', 400);
  if (e.status === 'discharged' || e.status === 'declined') throw new IntensiveError('This episode is closed', 400);
  const program = await requireProgram(actor, e.programId);
  if (!program.active) throw new IntensiveError('This program is not active', 400);
  const today = await orgToday(actor.organizationId);
  const r = await readinessFor(actor, e, program, client, today);
  if (!r.canAdmit) throw new IntensiveError(`Cannot admit yet: ${r.blockers.join('; ')}`, 400);
  return prisma.intensiveEnrollment.update({ where: { id: e.id }, data: { status: 'admitted' } });
}

export async function decline(actor: IntensiveActor, id: string, reason: string) {
  if (!canMakeClinicalDecisions(actor.role)) throw new IntensiveError('Not admitting is a clinical decision (licensed staff or leadership)', 403);
  const { e } = await requireEnrollment(actor, id);
  if (e.status === 'admitted' || e.status === 'discharged') throw new IntensiveError('Admitted clients are discharged, not declined', 400);
  return prisma.intensiveEnrollment.update({ where: { id: e.id }, data: { status: 'declined', dischargeReason: reason.trim(), transitionNotes: reason.trim() } });
}

export type DischargeInputBody = {
  dischargeDate: string;
  reason: string;
  stepDownLevel: string;
  aftercarePlan: string;
  dischargeSummaryNoteId?: string | null;
  followUpAppointmentId?: string | null;
  followUpDate?: string | null;
  followUpProvider?: string | null;
  transitionNotes?: string | null;
};

export async function discharge(actor: IntensiveActor, id: string, input: DischargeInputBody) {
  if (!canMakeClinicalDecisions(actor.role)) throw new IntensiveError('Discharge is a clinical decision (licensed staff or leadership)', 403);
  const { e } = await requireEnrollment(actor, id);
  if (e.status !== 'admitted' && e.status !== 'discharged') throw new IntensiveError('Only admitted clients are discharged', 400);
  const program = await requireProgram(actor, e.programId);
  const today = await orgToday(actor.organizationId);
  const problems = dischargeProblems(typeOf(program), {
    dischargeDate: input.dischargeDate,
    admissionDate: e.admissionDate ? isoDay(e.admissionDate) : null,
    reason: input.reason,
    stepDownLevel: input.stepDownLevel,
    aftercarePlan: input.aftercarePlan,
    today,
  });
  if (problems.length) throw new IntensiveError(problems.join('; '), 400);
  let followUpDate = input.followUpDate || null;
  if (input.followUpAppointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: { id: input.followUpAppointmentId, clientId: e.clientId, OR: [{ organizationId: actor.organizationId }, { organizationId: null }] },
      select: { startsAt: true },
    });
    if (!appt) throw new IntensiveError('Follow-up appointment not found for this client', 400);
    followUpDate = isoDay(appt.startsAt);
  }
  if (input.dischargeSummaryNoteId) {
    const n = await prisma.progressNote.findFirst({ where: { id: input.dischargeSummaryNoteId, clientId: e.clientId }, select: { id: true } });
    if (!n) throw new IntensiveError('Discharge summary note not found for this client', 400);
  }
  const updated = await prisma.intensiveEnrollment.update({
    where: { id: e.id },
    data: {
      status: 'discharged',
      dischargeDate: dayDate(input.dischargeDate),
      dischargeReason: input.reason,
      stepDownLevel: input.stepDownLevel,
      aftercarePlan: input.aftercarePlan.trim(),
      dischargeSummaryNoteId: input.dischargeSummaryNoteId || null,
      followUpAppointmentId: input.followUpAppointmentId || null,
      followUpDate: followUpDate ? dayDate(followUpDate) : null,
      followUpProvider: input.followUpProvider?.trim() || null,
      transitionNotes: input.transitionNotes?.trim() || null,
    },
  });
  // Open missed-day outreach after discharge is moot: close it with the reason
  await prisma.intensiveFollowUp.updateMany({
    where: { organizationId: actor.organizationId, enrollmentId: e.id, status: 'open' },
    data: { status: 'done', outcome: 'Closed at discharge', resolvedAt: new Date() },
  });
  return updated;
}

// ─── Daily roster & attendance ──────────────────────────────────────────────

export type RosterBlock = { key: string; label: string; start: string; minutes: number; sessionType: SessionType };
export type RosterClient = {
  enrollmentId: string;
  clientId: string;
  clientName: string;
  mrn: string | null;
  marks: Record<string, { status: AttendanceStatus; minutes: number | null; progressNoteId: string | null; groupSessionId: string | null; source: 'program' | 'group' }>;
  followUpOpen: boolean;
};

/** Group attendance from linked group sessions on the date (group-sessions module), by client. */
async function linkedGroupMarks(organizationId: string, groupIds: string[], date: string, clientIds: string[]) {
  if (!groupIds.length || !clientIds.length) return [] as Array<{ clientId: string; status: string; minutes: number | null; scheduled: number; sessionId: string; startsAt: Date; progressNoteId: string | null; billedByGroupNote: boolean }>;
  const start = dayDate(date);
  const end = dayDate(addDays(date, 1));
  const rows = await prisma.clinicalGroupAttendance.findMany({
    where: { organizationId, groupId: { in: groupIds }, clientId: { in: clientIds }, session: { startsAt: { gte: addHours(start, -14), lt: addHours(end, 14) }, status: { not: 'cancelled' } } },
    select: {
      clientId: true,
      status: true,
      minutesAttended: true,
      progressNoteId: true,
      session: { select: { id: true, startsAt: true, durationMinutes: true, group: { select: { billingMode: true, billingCode: true } } } },
    },
  });
  const tz = await getPracticeTimeZone(organizationId);
  return rows
    .filter((r) => practiceToday(tz, r.session.startsAt) === date)
    .map((r) => ({
      clientId: r.clientId,
      status: r.status,
      minutes: r.minutesAttended,
      scheduled: r.session.durationMinutes,
      sessionId: r.session.id,
      startsAt: r.session.startsAt,
      progressNoteId: r.progressNoteId,
      billedByGroupNote: r.session.group.billingMode === 'per_session' && Boolean(r.session.group.billingCode),
    }));
}

function addHours(d: Date, h: number) {
  return new Date(d.getTime() + h * 3_600_000);
}

/** Admitted on the date: admission on/before and not discharged before. */
function admittedOn(e: EnrollmentRow, date: string): boolean {
  if (!e.admissionDate || isoDay(e.admissionDate) > date) return false;
  if (e.status !== 'admitted' && e.status !== 'discharged') return false;
  return !e.dischargeDate || isoDay(e.dischargeDate) >= date;
}

export async function roster(actor: IntensiveActor, programId: string, date: string) {
  const program = await requireProgram(actor, programId);
  const type = typeOf(program);
  const schedule = parseSchedule(program.scheduleTemplate, type);
  const scoped = (await scopedEnrollments(actor, { programId, status: { in: ['admitted', 'discharged'] } })).filter(({ e }) => admittedOn(e, date));
  const ids = scoped.map(({ e }) => e.id);
  const [rows, followUps, groupMarks] = await Promise.all([
    ids.length
      ? prisma.intensiveAttendance.findMany({ where: { organizationId: actor.organizationId, enrollmentId: { in: ids }, serviceDate: dayDate(date) } })
      : Promise.resolve([]),
    ids.length
      ? prisma.intensiveFollowUp.findMany({ where: { organizationId: actor.organizationId, enrollmentId: { in: ids }, serviceDate: dayDate(date), status: 'open' }, select: { enrollmentId: true } })
      : Promise.resolve([]),
    linkedGroupMarks(actor.organizationId, program.linkedGroupIds, date, scoped.map(({ e }) => e.clientId)),
  ]);
  const open = new Set(followUps.map((f) => f.enrollmentId));
  const clients: RosterClient[] = scoped.map(({ e, client }) => {
    const marks: RosterClient['marks'] = {};
    for (const r of rows.filter((x) => x.enrollmentId === e.id)) {
      marks[r.blockKey] = { status: r.status as AttendanceStatus, minutes: r.minutes, progressNoteId: r.progressNoteId, groupSessionId: r.groupSessionId, source: 'program' };
    }
    // Linked group sessions fill group blocks not marked in the program roster (attendance taken in the group module)
    const mine = groupMarks.filter((g) => g.clientId === e.clientId).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const groupBlocks = schedule.blocks.filter((b) => b.sessionType === 'group' && !marks[b.key]);
    mine.forEach((g, i) => {
      const b = groupBlocks[i];
      if (!b || g.status === 'unmarked') return;
      marks[b.key] = { status: g.status as AttendanceStatus, minutes: g.minutes, progressNoteId: g.progressNoteId, groupSessionId: g.sessionId, source: 'group' };
    });
    return { enrollmentId: e.id, clientId: e.clientId, clientName: client.name, mrn: client.mrn, marks, followUpOpen: open.has(e.id) };
  });
  const programDay = schedule.days.includes(dayDate(date).getUTCDay());
  return { program: programView(program, null), date, programDay, blocks: schedule.blocks as RosterBlock[], clients };
}

export type AttendanceMarkInput = {
  enrollmentId: string;
  blockKey: string;
  status: AttendanceStatus;
  minutes?: number | null;
  progressNoteId?: string | null;
  note?: string | null;
};

export async function saveAttendance(actor: IntensiveActor, programId: string, date: string, marks: AttendanceMarkInput[]) {
  if (!canRecordProgramWork(actor.role)) throw new IntensiveError('Your role cannot record program attendance', 403);
  const program = await requireProgram(actor, programId);
  const today = await orgToday(actor.organizationId);
  if (date > today) throw new IntensiveError('Attendance cannot be recorded for a future date', 400);
  const type = typeOf(program);
  const schedule = parseSchedule(program.scheduleTemplate, type);
  const blocks = new Map(schedule.blocks.map((b) => [b.key, b]));
  const ids = [...new Set(marks.map((m) => m.enrollmentId))];
  const scoped = await scopedEnrollments(actor, { programId, id: { in: ids } });
  const byId = new Map(scoped.map((s) => [s.e.id, s]));
  for (const m of marks) {
    const s = byId.get(m.enrollmentId);
    if (!s) throw new IntensiveError('Enrollment not found in your program caseload', 404);
    if (!admittedOn(s.e, date)) throw new IntensiveError(`${s.client.name} was not admitted on ${date}`, 400);
    if (!blocks.has(m.blockKey)) throw new IntensiveError('Unknown session block', 400);
    if (isAttendedStatus(m.status) && (m.minutes === null || m.minutes === undefined)) {
      // Default to the scheduled block length; late / left early must state the minutes attended
      if (m.status !== 'present') throw new IntensiveError('Enter the minutes attended for late / left early', 400);
    }
  }
  const serviceDate = dayDate(date);
  await prisma.$transaction(
    marks.map((m) => {
      const s = byId.get(m.enrollmentId)!;
      const b = blocks.get(m.blockKey)!;
      const minutes = isAttendedStatus(m.status) ? Math.min(m.minutes ?? b.minutes, 600) : 0;
      const data = {
        sessionType: b.sessionType,
        status: m.status,
        minutes,
        scheduledMinutes: b.minutes,
        progressNoteId: m.progressNoteId || null,
        note: m.note?.trim() || null,
        recordedById: actor.userId,
        recordedByName: actor.name,
      };
      return prisma.intensiveAttendance.upsert({
        where: { enrollmentId_serviceDate_blockKey: { enrollmentId: m.enrollmentId, serviceDate, blockKey: m.blockKey } },
        create: { organizationId: actor.organizationId, programId, enrollmentId: m.enrollmentId, clientId: s.e.clientId, serviceDate, blockKey: m.blockKey, ...data },
        update: data,
      });
    }),
  );
  // Missed-day outreach: open (or close) a follow-up per client-day
  const policy = policyValues(program);
  let opened = 0;
  for (const id of ids) {
    const s = byId.get(id)!;
    const dayRows = await prisma.intensiveAttendance.findMany({ where: { organizationId: actor.organizationId, enrollmentId: id, serviceDate }, select: { status: true } });
    const need = missedDayNeedsFollowUp(dayRows.map((r) => r.status));
    const existing = await prisma.intensiveFollowUp.findUnique({ where: { enrollmentId_serviceDate: { enrollmentId: id, serviceDate } } });
    if (need && !existing) {
      await prisma.intensiveFollowUp.create({
        data: {
          organizationId: actor.organizationId,
          programId,
          enrollmentId: id,
          clientId: s.e.clientId,
          serviceDate,
          assignedToId: s.e.caseManagerId ?? s.e.primaryClinicianId,
          dueAt: followUpDueAt(date, policy.missedDayOutreachHours),
        },
      });
      opened += 1;
    } else if (!need && existing && existing.status === 'open' && !(existing.attempts as unknown[]).length) {
      // Attendance corrected (client did attend): drop the untouched outreach task
      await prisma.intensiveFollowUp.delete({ where: { id: existing.id } });
    }
  }
  return { saved: marks.length, followUpsOpened: opened, clientIds: [...new Set(scoped.map((s) => s.e.clientId))] };
}

// ─── Missed-day outreach ────────────────────────────────────────────────────

export async function logOutreach(
  actor: IntensiveActor,
  followUpId: string,
  input: { method: OutreachMethod; outcome: string; note?: string | null; resolve?: boolean },
) {
  if (!canRecordProgramWork(actor.role)) throw new IntensiveError('Your role cannot log outreach', 403);
  const f = await prisma.intensiveFollowUp.findFirst({ where: { id: followUpId, organizationId: actor.organizationId } });
  if (!f) throw new IntensiveError('Follow-up not found', 404);
  await requireEnrollment(actor, f.enrollmentId);
  const attempts = Array.isArray(f.attempts) ? (f.attempts as unknown as OutreachAttempt[]) : [];
  const next: OutreachAttempt = {
    at: new Date().toISOString(),
    byId: actor.userId,
    byName: actor.name,
    method: input.method,
    outcome: input.outcome.trim(),
    note: input.note?.trim() || null,
  };
  return prisma.intensiveFollowUp.update({
    where: { id: f.id },
    data: {
      attempts: [...attempts, next] as unknown as Prisma.InputJsonValue,
      ...(input.resolve ? { status: 'done', outcome: input.outcome.trim(), resolvedAt: new Date() } : {}),
    },
  });
}

// ─── Weekly team review ─────────────────────────────────────────────────────

export async function saveWeeklyReview(
  actor: IntensiveActor,
  enrollmentId: string,
  input: { weekStart: string; summary?: string | null; planChanges?: string | null; levelOfCareDecision?: string | null; prescriberSign?: boolean },
) {
  const { e } = await requireEnrollment(actor, enrollmentId);
  if (e.status !== 'admitted' && e.status !== 'discharged') throw new IntensiveError('Weekly reviews are for admitted clients', 400);
  const weekStart = weekStartOf(input.weekStart);
  const existing = await prisma.intensiveWeeklyReview.findUnique({ where: { enrollmentId_weekStart: { enrollmentId: e.id, weekStart: dayDate(weekStart) } } });
  if (input.prescriberSign) {
    if (!['PSYCHIATRIST', 'NP'].includes(String(actor.role))) throw new IntensiveError('Only a psychiatrist or NP signs the prescriber review', 403);
    if (!existing && !input.summary?.trim()) throw new IntensiveError('Write the team review summary first', 400);
  } else if (!canMakeClinicalDecisions(actor.role)) {
    throw new IntensiveError('Weekly team reviews are written by licensed staff or leadership', 403);
  }
  const rows = await prisma.intensiveAttendance.findMany({
    where: { organizationId: actor.organizationId, enrollmentId: e.id, serviceDate: { gte: dayDate(weekStart), lt: dayDate(addDays(weekStart, 7)) } },
    select: { serviceDate: true, status: true, minutes: true, scheduledMinutes: true },
  });
  const hours = weeklyHours(rows.map((r) => ({ ...r, serviceDate: isoDay(r.serviceDate) })), weekStart).hours;
  const sign = input.prescriberSign ? { prescriberReviewedById: actor.userId, prescriberReviewedByName: actor.name, prescriberReviewedAt: new Date() } : {};
  const body = {
    ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
    ...(input.planChanges !== undefined ? { planChanges: input.planChanges?.trim() || null } : {}),
    ...(input.levelOfCareDecision !== undefined ? { levelOfCareDecision: input.levelOfCareDecision?.trim() || null } : {}),
    hoursAttended: hours,
  };
  if (existing) return prisma.intensiveWeeklyReview.update({ where: { id: existing.id }, data: { ...body, ...sign } });
  if (!input.summary?.trim()) throw new IntensiveError('Summary is required', 400);
  return prisma.intensiveWeeklyReview.create({
    data: {
      organizationId: actor.organizationId,
      enrollmentId: e.id,
      clientId: e.clientId,
      weekStart: dayDate(weekStart),
      summary: input.summary.trim(),
      planChanges: input.planChanges?.trim() || null,
      levelOfCareDecision: input.levelOfCareDecision?.trim() || null,
      hoursAttended: hours,
      reviewedById: actor.userId,
      reviewedByName: actor.name,
      reviewedByRole: String(actor.role),
      ...sign,
    },
  });
}

// ─── Per-enrollment status (weekly hours, auth, plan, review, follow-up) ────

type Bundle = {
  program: ProgramRow;
  attendance: Array<{ enrollmentId: string; serviceDate: string; status: string; minutes: number | null; scheduledMinutes: number | null }>;
  drafts: Array<{ enrollmentId: string; code: string; units: number; status: string }>;
  auths: Map<string, { id: string; payer: string; authNumber: string | null; unitsApproved: number; unitsUsed: number; cptCodes: string[]; startDate: Date | null; endDate: Date | null }>;
  plans: Map<string, { id: string; signedOn: string | null; status: string }>;
  reviews: Array<{ enrollmentId: string; weekStart: string; prescriberReviewedAt: Date | null }>;
  followUps: Array<{ enrollmentId: string; status: string; dueAt: Date }>;
};

function enrollmentStatus(e: EnrollmentRow, b: Bundle, today: string) {
  const type = typeOf(b.program);
  const schedule = parseSchedule(b.program.scheduleTemplate, type);
  const policy = policyValues(b.program);
  const admission = e.admissionDate ? isoDay(e.admissionDate) : null;
  const discharge = e.dischargeDate ? isoDay(e.dischargeDate) : null;
  const mine = b.attendance.filter((a) => a.enrollmentId === e.id);
  const thisWeek = weekStartOf(discharge && discharge < today ? discharge : today);
  const lastWeek = addDays(thisWeek, -7);
  const wk = (ws: string) =>
    weekCompliance({ weekStart: ws, today, minWeeklyHours: policy.minWeeklyHours, schedule, admissionDate: admission, dischargeDate: discharge, attendedMinutes: weeklyHours(mine, ws).minutes });
  const weeks = admission && e.status !== 'referred' && e.status !== 'screening' ? { current: wk(thisWeek), previous: wk(lastWeek) } : null;
  const a = e.priorAuthId ? b.auths.get(e.priorAuthId) ?? null : null;
  const auth: (AuthStatus & { id: string; payer: string; authNumber: string | null; startDate: string | null; endDate: string | null }) | null = a
    ? {
        id: a.id,
        payer: a.payer,
        authNumber: a.authNumber,
        startDate: a.startDate ? isoDay(a.startDate) : null,
        endDate: a.endDate ? isoDay(a.endDate) : null,
        ...authStatus(
          { unitsApproved: a.unitsApproved, unitsUsedClaims: a.unitsUsed, cptCodes: a.cptCodes, startDate: a.startDate ? isoDay(a.startDate) : null, endDate: a.endDate ? isoDay(a.endDate) : null },
          b.drafts.filter((d) => d.enrollmentId === e.id),
          { today, leadDays: policy.authRenewalLeadDays, unitsPerWeek: unitsPerWeek(billingModeOf(b.program.billingMode), schedule) },
        ),
      }
    : null;
  const plan = b.plans.get(e.id) ?? null;
  const timeline = planTimeline({ admissionDate: admission, today, initialPlanDays: policy.initialPlanDays, planReviewDays: policy.planReviewDays, plan });
  const reviewRow = b.reviews.find((r) => r.enrollmentId === e.id && r.weekStart === lastWeek) ?? null;
  const thisReview = b.reviews.find((r) => r.enrollmentId === e.id && r.weekStart === thisWeek) ?? null;
  // The review for the previous full week is the one that is due; this week's is in progress
  const review =
    e.status === 'admitted' && admission && admission < thisWeek
      ? weeklyReviewStatus({ programType: type, review: reviewRow })
      : null;
  const followUp =
    e.status === 'discharged' && discharge
      ? followUpStatus({
          dischargeDate: discharge,
          followUpDate: e.followUpDate ? isoDay(e.followUpDate) : null,
          windowDays: policy.followUpWindowDays,
          today,
          expected: followUpExpected(e.stepDownLevel),
        })
      : null;
  const openOutreach = b.followUps.filter((f) => f.enrollmentId === e.id && f.status === 'open');
  return {
    weeks,
    auth,
    plan: { ...timeline, planId: plan?.id ?? null },
    review: review ? { ...review, weekStart: lastWeek, thisWeekStarted: Boolean(thisReview) } : null,
    followUp,
    outreachOpen: openOutreach.length,
    outreachOverdue: openOutreach.filter((f) => f.dueAt.getTime() < Date.now()).length,
  };
}

async function loadBundles(actor: IntensiveActor, rows: Array<{ e: EnrollmentRow }>, today: string) {
  const ids = rows.map((r) => r.e.id);
  const programIds = [...new Set(rows.map((r) => r.e.programId))];
  const since = dayDate(addDays(weekStartOf(today), -42));
  const [programs, attendance, drafts, auths, plans, reviews, followUps] = await Promise.all([
    prisma.intensiveProgram.findMany({ where: { organizationId: actor.organizationId, id: { in: programIds } } }),
    ids.length
      ? prisma.intensiveAttendance.findMany({
          where: { organizationId: actor.organizationId, enrollmentId: { in: ids }, serviceDate: { gte: since } },
          select: { enrollmentId: true, serviceDate: true, status: true, minutes: true, scheduledMinutes: true },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.intensiveChargeDraft.findMany({ where: { organizationId: actor.organizationId, enrollmentId: { in: ids }, status: { not: 'void' } }, select: { enrollmentId: true, code: true, units: true, status: true } })
      : Promise.resolve([]),
    prisma.priorAuth.findMany({
      where: { organizationId: actor.organizationId, id: { in: rows.map((r) => r.e.priorAuthId).filter((v): v is string => !!v) } },
      select: { id: true, payer: true, authNumber: true, unitsApproved: true, unitsUsed: true, cptCodes: true, startDate: true, endDate: true },
    }),
    prisma.treatmentPlan.findMany({
      where: { organizationId: actor.organizationId, clientId: { in: rows.map((r) => r.e.clientId) }, status: { in: ['ACTIVE', 'NEEDS_REVIEW'] } },
      select: { id: true, clientId: true, status: true, clinicianSignedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    ids.length
      ? prisma.intensiveWeeklyReview.findMany({ where: { organizationId: actor.organizationId, enrollmentId: { in: ids }, weekStart: { gte: since } }, select: { enrollmentId: true, weekStart: true, prescriberReviewedAt: true } })
      : Promise.resolve([]),
    ids.length
      ? prisma.intensiveFollowUp.findMany({ where: { organizationId: actor.organizationId, enrollmentId: { in: ids }, status: 'open' }, select: { enrollmentId: true, status: true, dueAt: true } })
      : Promise.resolve([]),
  ]);
  const programMap = new Map(programs.map((p) => [p.id, p]));
  const authMap = new Map(auths.map((a) => [a.id, a]));
  const att = attendance.map((a) => ({ ...a, serviceDate: isoDay(a.serviceDate) }));
  const rev = reviews.map((r) => ({ ...r, weekStart: isoDay(r.weekStart) }));
  const bundleFor = (e: EnrollmentRow): Bundle | null => {
    const program = programMap.get(e.programId);
    if (!program) return null;
    // Episode plan: the linked plan, else the newest active plan signed (or created) on/after admission
    const admission = e.admissionDate ? isoDay(e.admissionDate) : null;
    const clientPlans = plans.filter((p) => p.clientId === e.clientId);
    const linked = e.treatmentPlanId ? clientPlans.find((p) => p.id === e.treatmentPlanId) : null;
    const episode =
      linked ??
      (admission ? clientPlans.find((p) => isoDay(p.clinicianSignedAt ?? p.createdAt) >= admission && p.clinicianSignedAt) ?? null : null);
    const planMap = new Map<string, { id: string; signedOn: string | null; status: string }>();
    if (episode) planMap.set(e.id, { id: episode.id, signedOn: episode.clinicianSignedAt ? isoDay(episode.clinicianSignedAt) : null, status: episode.status });
    return { program, attendance: att, drafts, auths: authMap, plans: planMap, reviews: rev, followUps };
  };
  return bundleFor;
}

async function enrollmentRows(actor: IntensiveActor, scoped: Array<{ e: EnrollmentRow; client: ClientInfo }>, today: string) {
  const bundleFor = await loadBundles(actor, scoped, today);
  const names = await staffNames(actor.organizationId, scoped.flatMap(({ e }) => [e.primaryClinicianId, e.prescriberId, e.caseManagerId]));
  const out = [];
  for (const { e, client } of scoped) {
    const b = bundleFor(e);
    if (!b) continue;
    const type = typeOf(b.program);
    out.push({
      id: e.id,
      programId: e.programId,
      programName: b.program.name,
      programType: type,
      level: PROGRAM_TYPE_META[type].level,
      clientId: e.clientId,
      clientName: client.name,
      mrn: client.mrn,
      status: e.status,
      part2: e.part2,
      referralDate: isoDay(e.referralDate),
      admissionDate: e.admissionDate ? isoDay(e.admissionDate) : null,
      dischargeDate: e.dischargeDate ? isoDay(e.dischargeDate) : null,
      dischargeReason: e.dischargeReason,
      stepDownLevel: e.stepDownLevel,
      team: {
        primaryClinician: e.primaryClinicianId ? names.get(e.primaryClinicianId) ?? null : null,
        prescriber: e.prescriberId ? names.get(e.prescriberId) ?? null : null,
        caseManager: e.caseManagerId ? names.get(e.caseManagerId) ?? null : null,
      },
      isMine: e.primaryClinicianId === actor.userId || e.prescriberId === actor.userId || e.caseManagerId === actor.userId,
      ...enrollmentStatus(e, b, today),
    });
  }
  return out;
}
export type EnrollmentListRow = Awaited<ReturnType<typeof enrollmentRows>>[number];

export async function listEnrollments(actor: IntensiveActor, filter: { programId?: string | null; status?: string | null }) {
  const today = await orgToday(actor.organizationId);
  const where: Prisma.IntensiveEnrollmentWhereInput = {
    ...(filter.programId ? { programId: filter.programId } : {}),
    ...(filter.status === 'open' ? { status: { in: ['referred', 'screening', 'admitted'] } } : filter.status ? { status: filter.status } : {}),
  };
  const scoped = await scopedEnrollments(actor, where);
  return { today, rows: await enrollmentRows(actor, scoped, today) };
}

export async function enrollmentDetail(actor: IntensiveActor, id: string) {
  const hit = await requireEnrollment(actor, id);
  const { e, client } = hit;
  const program = await requireProgram(actor, e.programId);
  const today = await orgToday(actor.organizationId);
  const [row] = await enrollmentRows(actor, [hit], today);
  const type = typeOf(program);
  const schedule = parseSchedule(program.scheduleTemplate, type);
  const policy = policyValues(program);
  const admission = e.admissionDate ? isoDay(e.admissionDate) : null;
  const [attendance, reviews, followUps, auths, locus, notes, plans, appts, readiness] = await Promise.all([
    prisma.intensiveAttendance.findMany({ where: { organizationId: actor.organizationId, enrollmentId: e.id }, orderBy: [{ serviceDate: 'desc' }, { blockKey: 'asc' }], take: 400 }),
    prisma.intensiveWeeklyReview.findMany({ where: { organizationId: actor.organizationId, enrollmentId: e.id }, orderBy: { weekStart: 'desc' }, take: 52 }),
    prisma.intensiveFollowUp.findMany({ where: { organizationId: actor.organizationId, enrollmentId: e.id }, orderBy: { serviceDate: 'desc' }, take: 100 }),
    prisma.priorAuth.findMany({
      where: { organizationId: actor.organizationId, clientId: e.clientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, payer: true, authNumber: true, unitsApproved: true, unitsUsed: true, cptCodes: true, startDate: true, endDate: true, status: true },
    }),
    prisma.locusAssessmentRecord.findMany({
      where: { organizationId: actor.organizationId, clientId: e.clientId },
      orderBy: { assessmentDate: 'desc' },
      take: 10,
      select: { id: true, instrumentType: true, assessmentDate: true, compositeScore: true, recommendedLevel: true, overrideLevel: true },
    }),
    prisma.progressNote.findMany({
      where: { clientId: e.clientId, OR: [{ dateOfService: { gte: dayDate(addDays(isoDay(e.referralDate), -60)) } }, { createdAt: { gte: dayDate(addDays(isoDay(e.referralDate), -60)) } }] },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { id: true, noteType: true, dateOfService: true, createdAt: true, part2: true },
    }),
    prisma.treatmentPlan.findMany({
      where: { organizationId: actor.organizationId, clientId: e.clientId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, title: true, status: true, clinicianSignedAt: true, createdAt: true },
    }),
    prisma.appointment.findMany({
      where: { clientId: e.clientId, OR: [{ organizationId: actor.organizationId }, { organizationId: null }], startsAt: { gte: dayDate(addDays(today, -30)) }, status: { notIn: ['CANCELLED', 'LATE_CANCEL'] } },
      orderBy: { startsAt: 'asc' },
      take: 30,
      select: { id: true, type: true, startsAt: true, status: true, clinicianName: true },
    }),
    e.status === 'referred' || e.status === 'screening' ? readinessFor(actor, e, program, client, today) : Promise.resolve(null),
  ]);
  const att = attendance.map((a) => ({ ...a, serviceDate: isoDay(a.serviceDate) }));
  // Week-by-week hours since admission (latest first, up to 12 weeks)
  const weeks = [];
  if (admission) {
    const end = e.dischargeDate ? isoDay(e.dischargeDate) : today;
    for (let ws = weekStartOf(end), i = 0; ws >= weekStartOf(admission) && i < 12; ws = addDays(ws, -7), i++) {
      const c = weekCompliance({
        weekStart: ws,
        today,
        minWeeklyHours: policy.minWeeklyHours,
        schedule,
        admissionDate: admission,
        dischargeDate: e.dischargeDate ? isoDay(e.dischargeDate) : null,
        attendedMinutes: weeklyHours(att, ws).minutes,
      });
      const rv = reviews.find((r) => isoDay(r.weekStart) === ws) ?? null;
      weeks.push({ ...c, review: rv ? { id: rv.id, summary: rv.summary, by: rv.reviewedByName, prescriberBy: rv.prescriberReviewedByName, prescriberAt: rv.prescriberReviewedAt?.toISOString() ?? null } : null, ...weeklyReviewStatus({ programType: type, review: rv }) });
    }
  }
  const s = screeningOf(e);
  return {
    today,
    program: programView(program, null),
    enrollment: {
      ...row,
      referralSource: e.referralSource,
      referralReason: e.referralReason,
      screening: s,
      priorAuthId: e.priorAuthId,
      psychEvalDate: e.psychEvalDate ? isoDay(e.psychEvalDate) : null,
      psychEvalNoteId: e.psychEvalNoteId,
      primaryClinicianId: e.primaryClinicianId,
      prescriberId: e.prescriberId,
      caseManagerId: e.caseManagerId,
      treatmentPlanId: e.treatmentPlanId,
      aftercarePlan: e.aftercarePlan,
      dischargeSummaryNoteId: e.dischargeSummaryNoteId,
      followUpAppointmentId: e.followUpAppointmentId,
      followUpDate: e.followUpDate ? isoDay(e.followUpDate) : null,
      followUpProvider: e.followUpProvider,
      transitionNotes: e.transitionNotes,
      clientAgeYears: ageYears(client.dateOfBirth, today),
    },
    readiness,
    weeks,
    attendance: att.slice(0, 120).map((a) => ({ id: a.id, serviceDate: a.serviceDate, blockKey: a.blockKey, sessionType: a.sessionType, status: a.status, minutes: a.minutes, progressNoteId: a.progressNoteId, counted: attendedMinutes(a) })),
    followUps: followUps.map((f) => ({ id: f.id, serviceDate: isoDay(f.serviceDate), dueAt: f.dueAt.toISOString(), status: f.status, outcome: f.outcome, attempts: f.attempts as unknown as OutreachAttempt[] })),
    options: {
      auths: auths.map((a) => ({ id: a.id, payer: a.payer, authNumber: a.authNumber, unitsApproved: a.unitsApproved, unitsUsed: a.unitsUsed, codes: a.cptCodes, startDate: a.startDate ? isoDay(a.startDate) : null, endDate: a.endDate ? isoDay(a.endDate) : null, status: a.status })),
      locus: locus.map((l) => ({ id: l.id, type: l.instrumentType, date: isoDay(l.assessmentDate), score: l.compositeScore, level: l.overrideLevel || l.recommendedLevel })),
      // Part 2 notes are listed only on Part 2 episodes (records stay apart)
      notes: notes.filter((n) => e.part2 || !n.part2).map((n) => ({ id: n.id, type: n.noteType, date: isoDay(n.dateOfService ?? n.createdAt) })),
      plans: plans.map((p) => ({ id: p.id, title: p.title, status: p.status, signedOn: p.clinicianSignedAt ? isoDay(p.clinicianSignedAt) : null })),
      appointments: appts.map((a) => ({ id: a.id, type: a.type, date: isoDay(a.startsAt), status: a.status, clinician: a.clinicianName })),
    },
  };
}

// ─── Charge drafts ──────────────────────────────────────────────────────────

export async function generateCharges(actor: IntensiveActor, programId: string, from: string, to: string) {
  if (!canGenerateCharges(actor.role)) throw new IntensiveError('Only billing or leadership generate charge drafts', 403);
  if (to < from || ((dayDate(to).getTime() - dayDate(from).getTime()) / 86_400_000) > 31) throw new IntensiveError('Choose a date range of up to 31 days', 400);
  const program = await prisma.intensiveProgram.findFirst({ where: { id: programId, organizationId: actor.organizationId } });
  if (!program) throw new IntensiveError('Program not found', 404);
  const today = await orgToday(actor.organizationId);
  if (to > today) throw new IntensiveError('Charge drafts are for past or current dates only', 400);
  const type = typeOf(program);
  const enrollments = await prisma.intensiveEnrollment.findMany({
    where: { organizationId: actor.organizationId, programId, status: { in: ['admitted', 'discharged'] }, admissionDate: { lte: dayDate(to) } },
  });
  // Billing works org-wide (no caseload) but never a client outside the org
  const inOrg = new Set(
    (await prisma.client.findMany({ where: { id: { in: enrollments.map((e) => e.clientId) }, AND: [clientOrgFilter(actor.organizationId)] }, select: { id: true } })).map((c) => c.id),
  );
  const ids = enrollments.filter((e) => inOrg.has(e.clientId)).map((e) => e.id);
  const [attendance, auths, existingDrafts] = await Promise.all([
    prisma.intensiveAttendance.findMany({ where: { organizationId: actor.organizationId, enrollmentId: { in: ids }, serviceDate: { gte: dayDate(from), lte: dayDate(to) } } }),
    prisma.priorAuth.findMany({
      where: { organizationId: actor.organizationId, id: { in: enrollments.map((e) => e.priorAuthId).filter((v): v is string => !!v) } },
      select: { id: true, unitsApproved: true, unitsUsed: true, cptCodes: true, startDate: true, endDate: true },
    }),
    prisma.intensiveChargeDraft.findMany({ where: { organizationId: actor.organizationId, enrollmentId: { in: ids }, status: { not: 'void' } }, select: { enrollmentId: true, code: true, units: true, status: true, serviceDate: true, sourceKey: true } }),
  ]);
  // Group sessions billed per session through the group note claim builder (never billed twice)
  const groupSessionIds = [...new Set(attendance.map((a) => a.groupSessionId).filter((v): v is string => !!v))];
  const perSessionGroups = new Set(
    groupSessionIds.length
      ? (
          await prisma.clinicalGroupSession.findMany({
            where: { organizationId: actor.organizationId, id: { in: groupSessionIds }, group: { billingMode: 'per_session', billingCode: { not: null } } },
            select: { id: true },
          })
        ).map((s) => s.id)
      : [],
  );
  const authMap = new Map(auths.map((a) => [a.id, a]));
  const mode = billingModeOf(program.billingMode);
  let created = 0;
  let updated = 0;
  let held = 0;
  const skipped: Array<{ enrollmentId: string; date: string; reason: string }> = [];
  for (const e of enrollments.filter((x) => ids.includes(x.id))) {
    const rows = attendance.filter((a) => a.enrollmentId === e.id);
    const days = [...new Set(rows.map((r) => isoDay(r.serviceDate)))].sort();
    for (const day of days) {
      const a = e.priorAuthId ? authMap.get(e.priorAuthId) ?? null : null;
      // Units left before this day's draft (other days' drafts already count)
      const priorDrafts = existingDrafts.filter((d) => d.enrollmentId === e.id && isoDay(d.serviceDate) !== day);
      const st = a
        ? authStatus(
            { unitsApproved: a.unitsApproved, unitsUsedClaims: a.unitsUsed, cptCodes: a.cptCodes, startDate: a.startDate ? isoDay(a.startDate) : null, endDate: a.endDate ? isoDay(a.endDate) : null },
            priorDrafts,
            { today, leadDays: 0, unitsPerWeek: 0 },
          )
        : null;
      const { lines, skipped: sk } = draftsForDay(
        {
          programType: type,
          billingMode: mode,
          perDiemCode: perDiemCodeOf(program),
          serviceCodes: parseServiceCodes(program.serviceCodes, type),
          unitRules: parseUnitRules(program.unitRules, type),
          policyConfirmed: Boolean(program.policyConfirmedAt),
          serviceDate: day,
          admissionDate: e.admissionDate ? isoDay(e.admissionDate) : null,
          dischargeDate: e.dischargeDate ? isoDay(e.dischargeDate) : null,
          psychEvalDate: e.psychEvalDate ? isoDay(e.psychEvalDate) : null,
          auth: a && st ? { id: a.id, startDate: a.startDate ? isoDay(a.startDate) : null, endDate: a.endDate ? isoDay(a.endDate) : null, remaining: st.remaining, approved: a.unitsApproved } : null,
        },
        rows
          .filter((r) => isoDay(r.serviceDate) === day)
          .map<DraftAttendance>((r) => ({
            id: r.id,
            sessionType: r.sessionType as SessionType,
            status: r.status,
            minutes: r.minutes,
            scheduledMinutes: r.scheduledMinutes,
            progressNoteId: r.progressNoteId,
            billedByGroupNote: Boolean(r.groupSessionId && perSessionGroups.has(r.groupSessionId)),
          })),
      );
      for (const s of sk) skipped.push({ enrollmentId: e.id, date: day, reason: s.reason });
      for (const l of lines) {
        const key = { enrollmentId_serviceDate_code_sourceKey: { enrollmentId: e.id, serviceDate: dayDate(day), code: l.code, sourceKey: l.sourceKey } };
        const prev = await prisma.intensiveChargeDraft.findUnique({ where: key, select: { id: true, status: true } });
        if (prev?.status === 'void') continue; // billing voided it: leave it
        const data = { units: l.units, minutes: l.minutes, status: l.status, holdReasons: l.holdReasons, priorAuthId: e.priorAuthId, part2: e.part2 };
        if (prev) {
          await prisma.intensiveChargeDraft.update({ where: { id: prev.id }, data });
          updated += 1;
        } else {
          await prisma.intensiveChargeDraft.create({
            data: { organizationId: actor.organizationId, programId, enrollmentId: e.id, clientId: e.clientId, serviceDate: dayDate(day), code: l.code, sourceKey: l.sourceKey, createdById: actor.userId, ...data },
          });
          existingDrafts.push({ enrollmentId: e.id, code: l.code, units: l.units, status: l.status, serviceDate: dayDate(day), sourceKey: l.sourceKey });
          created += 1;
        }
        if (l.status === 'held') held += 1;
      }
    }
  }
  return { created, updated, held, skipped: skipped.slice(0, 200), enrollments: ids.length };
}

export async function listCharges(actor: IntensiveActor, filter: { programId?: string | null; from: string; to: string; status?: string | null }) {
  if (!canReadCharges(actor.role)) throw new IntensiveError('Your role cannot read charge drafts', 403);
  const rows = await prisma.intensiveChargeDraft.findMany({
    where: {
      organizationId: actor.organizationId,
      serviceDate: { gte: dayDate(filter.from), lte: dayDate(filter.to) },
      ...(filter.programId ? { programId: filter.programId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: [{ serviceDate: 'asc' }, { code: 'asc' }],
    take: 2000,
  });
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const [clients, programs, locked] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds }, AND: [clientOrgFilter(actor.organizationId)] }, select: { id: true, name: true, mrn: true } }),
    prisma.intensiveProgram.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, name: true, programType: true } }),
    lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientIds }),
  ]);
  const byClient = new Map(clients.map((c) => [c.id, c]));
  const byProgram = new Map(programs.map((p) => [p.id, p]));
  return rows
    .filter((r) => byClient.has(r.clientId))
    .map((r) => {
      const c = byClient.get(r.clientId)!;
      const masked = locked.has(r.clientId);
      return {
        id: r.id,
        programId: r.programId,
        programName: byProgram.get(r.programId)?.name ?? 'Program',
        clientId: masked ? null : r.clientId,
        clientName: masked ? 'Protected record' : c.name,
        mrn: masked ? null : c.mrn,
        serviceDate: isoDay(r.serviceDate),
        code: r.code,
        units: r.units,
        minutes: r.minutes,
        status: r.status,
        holdReasons: r.holdReasons,
        part2: r.part2,
      };
    });
}

export async function voidCharge(actor: IntensiveActor, id: string, restore = false) {
  if (!canGenerateCharges(actor.role)) throw new IntensiveError('Only billing or leadership change charge drafts', 403);
  const r = await prisma.intensiveChargeDraft.findFirst({ where: { id, organizationId: actor.organizationId }, select: { id: true, clientId: true, holdReasons: true } });
  if (!r) throw new IntensiveError('Charge draft not found', 404);
  return prisma.intensiveChargeDraft.update({ where: { id }, data: { status: restore ? (r.holdReasons.length ? 'held' : 'draft') : 'void' } });
}

// ─── Hub ────────────────────────────────────────────────────────────────────

/** Director rollups: census, attendance %, under-minimum, auths, discharges, outcomes. */
async function rollups(actor: IntensiveActor, rows: EnrollmentListRow[], programs: ProgramView[], today: string) {
  const admitted = rows.filter((r) => r.status === 'admitted');
  const since = addDays(today, -28);
  const att = admitted.length
    ? await prisma.intensiveAttendance.findMany({
        where: { organizationId: actor.organizationId, enrollmentId: { in: admitted.map((r) => r.id) }, serviceDate: { gte: dayDate(since), lte: dayDate(today) } },
        select: { programId: true, status: true },
      })
    : [];
  const perProgram = programs.map((p) => {
    const mine = admitted.filter((r) => r.programId === p.id);
    const a = att.filter((x) => x.programId === p.id);
    const attended = a.filter((x) => isAttendedStatus(x.status)).length;
    return {
      programId: p.id,
      name: p.name,
      programType: p.programType,
      census: mine.length,
      referralsOpen: rows.filter((r) => r.programId === p.id && (r.status === 'referred' || r.status === 'screening')).length,
      attendancePct: a.length ? Math.round((attended / a.length) * 1000) / 10 : null,
      sessionsRecorded28d: a.length,
      underMinimumLastWeek: mine.filter((r) => r.weeks?.previous.status === 'under').length,
      atRiskThisWeek: mine.filter((r) => r.weeks?.current.status === 'at_risk').length,
      authsRenewalDue: mine.filter((r) => r.auth?.renewalDue).length,
      noAuth: mine.filter((r) => !r.auth).length,
      reviewsMissing: mine.filter((r) => r.review && r.review.missing.length).length,
      plansOverdue: mine.filter((r) => r.plan.initialState === 'overdue' || r.plan.reviewState === 'overdue').length,
    };
  });
  // Discharges in the last 30 days: follow-up within the window
  const recent = rows.filter((r) => r.status === 'discharged' && r.dischargeDate && r.dischargeDate >= addDays(today, -30));
  const expected = recent.filter((r) => r.followUp && r.followUp.state !== 'not_expected');
  const met = expected.filter((r) => r.followUp?.state === 'met').length;
  const decided = expected.filter((r) => ['met', 'missed', 'outside_window'].includes(String(r.followUp?.state))).length;

  // Outcomes (PHQ-9 / GAD-7 / BAM) for clients admitted in the last 180 days, small cells suppressed
  const cohort = rows.filter((r) => r.admissionDate && r.admissionDate >= addDays(today, -180) && (r.status === 'admitted' || r.status === 'discharged'));
  const admissions = new Map(cohort.map((r) => [r.clientId, r.admissionDate as string]));
  const mhIds = cohort.filter((r) => !r.part2).map((r) => r.clientId);
  const sudIds = cohort.filter((r) => r.part2).map((r) => r.clientId);
  const [scores, bam] = await Promise.all([
    cohort.length
      ? prisma.clinicalAssessmentRecord.findMany({
          where: { organizationId: actor.organizationId, clientId: { in: cohort.map((r) => r.clientId) }, instrumentId: { in: [PHQ9.id, GAD7.id] }, totalScore: { not: null } },
          select: { clientId: true, instrumentId: true, totalScore: true, createdAt: true },
        })
      : Promise.resolve([]),
    sudIds.length
      ? prisma.sudScreening.findMany({ where: { organizationId: actor.organizationId, clientId: { in: sudIds }, tool: 'BAM' }, select: { clientId: true, riskLevel: true, createdAt: true } })
      : Promise.resolve([]),
  ]);
  const pts = (id: string) => scores.filter((s) => s.instrumentId === id).map((s) => ({ clientId: s.clientId, score: s.totalScore as number, at: isoDay(s.createdAt) }));
  const RISK: Record<string, number> = { NEGATIVE: 0, POSITIVE: 1, HIGH_RISK: 2 };
  const bamPairs = pairScores(bam.map((b) => ({ clientId: b.clientId, score: RISK[b.riskLevel] ?? 0, at: isoDay(b.createdAt) })), admissions);
  const bamSummary = outcomeSummary(bamPairs);
  return {
    perProgram,
    followUp7: { discharges30d: recent.length, expected: expected.length, ...suppressedRate(met, decided) },
    outcomes: {
      cohortNote: 'Clients admitted in the last 180 days; first score from 14 days before admission vs latest. Fewer than 10 paired clients: suppressed.',
      phq9: outcomeSummary(pairScores(pts(PHQ9.id), admissions)),
      gad7: outcomeSummary(pairScores(pts(GAD7.id), admissions)),
      // BAM risk level (negative / positive / high): only the share improved is shown
      bam: { n: bamSummary.n, suppressed: bamSummary.suppressed, improvedPct: bamSummary.improvedPct },
      mhClients: mhIds.length,
      sudClients: sudIds.length,
    },
  };
}

export async function hub(actor: IntensiveActor) {
  const today = await orgToday(actor.organizationId);
  const leader = canSeeRollups(actor.role, actor.medicalDirector);
  const programs = await listPrograms(actor, { includeInactive: leader });
  const scoped = await scopedEnrollments(actor, {
    OR: [{ status: { in: ['referred', 'screening', 'admitted'] } }, { status: 'discharged', dischargeDate: { gte: dayDate(addDays(today, -30)) } }],
  });
  const rows = await enrollmentRows(actor, scoped, today);
  const todayPrograms = programs.filter((p) => p.active && p.schedule.days.includes(dayDate(today).getUTCDay()));
  const mine = rows.filter((r) => r.status === 'admitted' && (r.isMine || !leader));
  const outreach = await prisma.intensiveFollowUp.findMany({
    where: { organizationId: actor.organizationId, status: 'open', enrollmentId: { in: rows.map((r) => r.id) } },
    orderBy: { dueAt: 'asc' },
    take: 200,
    select: { id: true, enrollmentId: true, serviceDate: true, dueAt: true, assignedToId: true, attempts: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    today,
    leader,
    canManage: canManagePrograms(actor.role),
    canDecide: canMakeClinicalDecisions(actor.role),
    canBill: canReadCharges(actor.role),
    programs,
    todayPrograms: todayPrograms.map((p) => ({ id: p.id, name: p.name, programType: p.programType, blocks: p.schedule.blocks.length, perDayMinutes: p.scheduleMinutes.perDay })),
    myClients: mine,
    enrollments: rows,
    outreach: outreach.map((o) => {
      const r = byId.get(o.enrollmentId);
      return {
        id: o.id,
        enrollmentId: o.enrollmentId,
        clientName: r?.clientName ?? 'Client',
        programName: r?.programName ?? '',
        serviceDate: isoDay(o.serviceDate),
        dueAt: o.dueAt.toISOString(),
        overdue: o.dueAt.getTime() < Date.now(),
        mine: o.assignedToId === actor.userId,
        attempts: Array.isArray(o.attempts) ? (o.attempts as unknown[]).length : 0,
      };
    }),
    rollups: leader ? await rollups(actor, rows, programs.filter((p) => p.active), today) : null,
  };
}

/** Org staff for team pickers (names only). */
export async function staffOptions(actor: IntensiveActor) {
  const users = await prisma.user.findMany({
    where: { organizationId: actor.organizationId, status: 'ACTIVE', role: { in: ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as Role[] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
    take: 500,
  });
  const locations = await prisma.location.findMany({ where: { organizationId: actor.organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const groups = canManagePrograms(actor.role)
    ? await prisma.clinicalGroup.findMany({ where: { organizationId: actor.organizationId, status: { not: 'archived' } }, select: { id: true, name: true, kind: true, groupType: true, billingMode: true, billingCode: true }, orderBy: { name: 'asc' } })
    : [];
  return {
    staff: users.map((u) => ({ id: u.id, name: u.name || u.email, role: String(u.role) })),
    locations,
    groups,
  };
}

/** Clients the actor may refer (caseload scope), by name search. */
export async function searchClients(actor: IntensiveActor, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await prisma.client.findMany({
    where: {
      AND: [
        isIntensiveLeadership(actor.role, actor.medicalDirector)
          ? clientOrgFilter(actor.organizationId)
          : clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role }),
        { OR: [{ name: { contains: term, mode: 'insensitive' } }, { mrn: { contains: term, mode: 'insensitive' } }] },
      ],
    },
    select: { id: true, name: true, mrn: true },
    take: 20,
    orderBy: { name: 'asc' },
  });
  const locked = await lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientIds: rows.map((r) => r.id) });
  return rows.filter((r) => !locked.has(r.id));
}

export { programDaysInWeek };
export type { ScheduleTemplate };

/** Program names for the charge-drafts page (billing roles; no PHI). */
export async function chargePrograms(actor: IntensiveActor) {
  if (!canReadCharges(actor.role)) return [];
  const rows = await prisma.intensiveProgram.findMany({ where: { organizationId: actor.organizationId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], select: { id: true, name: true, programType: true } });
  return rows.map((p) => ({ id: p.id, name: p.name, typeLabel: PROGRAM_TYPE_META[typeOf(p)].label }));
}
