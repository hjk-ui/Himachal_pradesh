/**
 * TMS case workflow storage + server actions (tms_case_workflows, tms_payer_rules;
 * 20261027_tms_workflow.sql). Rules live in src/lib/tms/workflow.ts.
 *
 * Scope: every read / write goes through the TMS course (organization + clientAccessWhere), except
 * the billing hand-off list / verification, which billing roles reach through the To-Do with only
 * the fields billing needs (client, payer, stage, packet completeness: no clinical content).
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { createSeries } from '@/lib/scheduling/series';
import { createRiskAlert } from '@/lib/alerts/manage';
import { activeKeyFor } from '@/lib/measures/schedule';
import { clinicDate } from '@/lib/workflows/dates';
import { TMS_CONTRAINDICATIONS } from '@/features/ehr/tmsSpravatoConstants';
import {
  OWNER_PAYER_RULE_SEEDS,
  OWNER_RULE_SOURCE,
  OWNER_RULE_SOURCE_V2,
  TMS_SESSION_MINUTES,
  TMS_WEEKDAYS,
  ageYearsFrom,
  checkPrescriber,
  countAdtTrials,
  courseSeriesChunks,
  courseTargetSessions,
  criteriaChecklist,
  criteriaIncomplete,
  defaultSessionCount,
  isTmsPrescriber,
  isTmsStage,
  matchPayerRules,
  packetMissing,
  payerMinFailedTrials,
  payerRuleHint,
  phq9Worsening,
  providerKindForUser,
  startCourseBlockers,
  tmsConsentHref,
  weeklyMeasureFor,
  ybocsSeverity,
  ybocsWorsening,
  type CriteriaItem,
  type PrescriberCheck,
  type StageEntry,
  type TmsEvaluation,
  type TmsIndication,
  type TmsPacket,
  type TmsPayerRuleRow,
  type TmsPrescriberRule,
  type TmsStage,
} from '@/lib/tms/workflow';

/** roles: every role assigned to the user (User.roles); TMS prescriber checks use role + roles. */
export type TmsActor = { organizationId: string; userId: string; role: Role; roles?: Role[]; name?: string | null };

export class TmsWorkflowError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** TMS CPT codes on a prior authorization (90867 planning, 90868 delivery, 90869 re-determination). */
const TMS_CPTS = ['90867', '90868', '90869'];
const PRESCRIBER_ROLES: Role[] = ['PSYCHIATRIST', 'NP'];
/** Psychiatrists / NPs by primary role OR any assigned role (User.roles). */
const PRESCRIBER_WHERE = { OR: [{ role: { in: PRESCRIBER_ROLES } }, { roles: { hasSome: PRESCRIBER_ROLES } }] };

// ─── Payer rules ─────────────────────────────────────────────────────────────

/** Match terms per rule (Medicaid carries the Maryland HealthChoice MCO names). */
export const MAX_MATCH_TERMS = 30;

/** Insert the owner's rules that are missing for this org (never overwrites a staff edit). */
export async function ensureOwnerPayerRules(organizationId: string): Promise<void> {
  await prisma.tmsPayerRule.createMany({
    data: OWNER_PAYER_RULE_SEEDS.map((r) => ({
      organizationId,
      payerKey: r.payerKey,
      payerLabel: r.payerLabel,
      matchTerms: r.matchTerms,
      payerTypes: r.payerTypes,
      rule: r.rule,
      note: 'Practice setting provided by the owner (Oct 27 2026). Staff may edit.',
      source: OWNER_RULE_SOURCE_V2,
    })),
    skipDuplicates: true,
  });
  // One-time upgrade of rows seeded before Oct 28 2026: add the new seed match terms (e.g. the
  // Maryland Medicaid / HealthChoice names); terms are only added, never removed.
  const old = await prisma.tmsPayerRule.findMany({ where: { organizationId, source: OWNER_RULE_SOURCE }, select: { id: true, payerKey: true, matchTerms: true } });
  for (const row of old) {
    const seed = OWNER_PAYER_RULE_SEEDS.find((r) => r.payerKey === row.payerKey);
    const terms = [...new Set([...row.matchTerms, ...(seed?.matchTerms ?? [])])];
    await prisma.tmsPayerRule.update({ where: { id: row.id }, data: { matchTerms: terms, source: OWNER_RULE_SOURCE_V2 } });
  }
}

export type TmsPayerRuleView = TmsPayerRuleRow & { id: string; source: string; updatedAt: string; hint: string | null };

export async function loadPayerRules(organizationId: string): Promise<TmsPayerRuleView[]> {
  await ensureOwnerPayerRules(organizationId);
  const rows = await prisma.tmsPayerRule.findMany({ where: { organizationId }, orderBy: { payerLabel: 'asc' } });
  return rows.map((r) => ({
    id: r.id,
    payerKey: r.payerKey,
    payerLabel: r.payerLabel,
    matchTerms: r.matchTerms,
    payerTypes: r.payerTypes,
    rule: r.rule as TmsPrescriberRule,
    note: r.note,
    active: r.active,
    minFailedTrials: r.minFailedTrials ?? null,
    hint: payerRuleHint(r.payerKey),
    source: r.source,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function savePayerRule(actor: TmsActor, input: { payerKey?: string | null; payerLabel: string; matchTerms: string[]; payerTypes: string[]; rule: TmsPrescriberRule; note?: string | null; active?: boolean; minFailedTrials?: number | null }) {
  const key = (input.payerKey || input.payerLabel).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
  if (!key) throw new TmsWorkflowError('Payer name required');
  const terms = [...new Set(input.matchTerms.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_MATCH_TERMS);
  const types = [...new Set(input.payerTypes.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 6);
  if (!terms.length && !types.length) throw new TmsWorkflowError('Add at least one payer name term or payer type to match on');
  const minFailedTrials = typeof input.minFailedTrials === 'number' && input.minFailedTrials > 0 ? Math.floor(input.minFailedTrials) : null;
  const data = { payerLabel: input.payerLabel.trim(), matchTerms: terms, payerTypes: types, rule: input.rule, note: input.note?.trim() || null, active: input.active ?? true, minFailedTrials, updatedById: actor.userId };
  return prisma.tmsPayerRule.upsert({
    where: { organizationId_payerKey: { organizationId: actor.organizationId, payerKey: key } },
    create: { organizationId: actor.organizationId, payerKey: key, source: 'staff', ...data },
    update: data,
  });
}

// ─── Practice default device ─────────────────────────────────────────────────

export type TmsPracticeDefaults = { deviceName: string | null; deviceDetail: string | null; updatedAt: string | null };

/** The clinic's TMS device, set once; new cases prefill it (tms_practice_defaults). */
export async function loadPracticeDefaults(organizationId: string): Promise<TmsPracticeDefaults> {
  const row = await prisma.tmsPracticeDefault.findUnique({ where: { organizationId } }).catch(() => null);
  return { deviceName: row?.deviceName ?? null, deviceDetail: row?.deviceDetail ?? null, updatedAt: row?.updatedAt.toISOString() ?? null };
}

export async function savePracticeDefaults(actor: TmsActor, input: { deviceName: string | null; deviceDetail: string | null }): Promise<TmsPracticeDefaults> {
  const data = { deviceName: input.deviceName?.trim() || null, deviceDetail: input.deviceDetail?.trim() || null, updatedById: actor.userId };
  await prisma.tmsPracticeDefault.upsert({ where: { organizationId: actor.organizationId }, create: { organizationId: actor.organizationId, ...data }, update: data });
  return loadPracticeDefaults(actor.organizationId);
}

// ─── Workflow view ───────────────────────────────────────────────────────────

type WorkflowRow = NonNullable<Awaited<ReturnType<typeof prisma.tmsCaseWorkflow.findUnique>>>;

async function scopedCourse(actor: TmsActor, courseId: string) {
  const course = await prisma.tmsCourse.findFirst({
    where: { id: courseId, organizationId: actor.organizationId, client: clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role }) },
    select: { id: true, clientId: true, createdAt: true, screeningJson: true, adtTrialsJson: true, targetSessions: true, status: true, client: { select: { name: true, dateOfBirth: true } } },
  });
  if (!course) throw new TmsWorkflowError('Course not found', 404);
  return course;
}

/** The client's payer: primary coverage, else the intake insurance fields. */
async function clientPayer(organizationId: string, clientId: string): Promise<{ name: string | null; type: string | null }> {
  const [cov, client] = await Promise.all([
    prisma.clientInsuranceCoverage
      .findFirst({ where: { organizationId, clientId, rank: 'P', active: true }, select: { payerName: true } })
      .catch(() => null),
    prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { insurancePayer: true, insuranceType: true } }),
  ]);
  return { name: cov?.payerName || client?.insurancePayer || null, type: client?.insuranceType || null };
}

function absoluteContraindications(screeningJson: unknown): number {
  const s = screeningJson && typeof screeningJson === 'object' ? (screeningJson as Record<string, unknown>) : {};
  return TMS_CONTRAINDICATIONS.filter((c) => c.absolute && s[c.id] === true).length;
}

function history(row: WorkflowRow | null): StageEntry[] {
  const raw = row?.stageHistory;
  return Array.isArray(raw) ? (raw.filter((h) => h && typeof h === 'object' && isTmsStage((h as StageEntry).stage)) as StageEntry[]) : [];
}

export type TmsWorkflowView = {
  courseId: string;
  clientId: string;
  stage: TmsStage;
  stageEnteredAt: string;
  stageHistory: StageEntry[];
  ownerId: string | null;
  ownerName: string | null;
  referralSource: 'external' | 'none' | null;
  referringProvider: string | null;
  packet: TmsPacket;
  packetMissing: string[];
  medMgmtAppointment: { id: string; startsAt: string } | null;
  insuranceSentAt: string | null;
  verificationStatus: string | null;
  authStatus: string | null;
  authorizedSessions: number | null;
  billingNote: string | null;
  priorAuth: { id: string; authNumber: string | null; unitsApproved: number; startDate: string | null; endDate: string | null } | null;
  indication: TmsIndication | null;
  deviceName: string | null;
  /** Cleared indications / coil (free text) */
  deviceDetail: string | null;
  /** true when the device shown comes from the practice default (not yet saved on the case) */
  deviceFromPracticeDefault: boolean;
  practiceDevice: TmsPracticeDefaults;
  deviceClearedForIndication: boolean | null;
  orderingProviderId: string | null;
  payerVerified: boolean | null;
  payerVerifyNote: string | null;
  evaluation: TmsEvaluation;
  scheduledSessions: number | null;
  seriesIds: string[];
  measureAssignmentId: string | null;
  payer: { name: string | null; type: string | null };
  matchedRules: { payerKey: string; payerLabel: string; rule: TmsPrescriberRule; minFailedTrials: number | null; hint: string | null }[];
  prescriber: PrescriberCheck;
  startBlockers: string[];
  /** Payer medical-necessity documentation checklist (shown for every payer; required when plan specific) */
  criteria: CriteriaItem[];
  criteriaIncomplete: string[];
  criteriaRequired: boolean;
  failedTrials: number;
  payerMinimum: number | null;
  /** Course target: entered, booked or authorized count; null = "Not set" */
  targetSessions: number | null;
  consentHref: string;
  defaultSessions: number | null;
  /** kind: from all of the provider's roles (psychiatrist when any role is PSYCHIATRIST) */
  providers: { id: string; name: string; role: string; kind: 'psychiatrist' | 'np' }[];
  weeklyMeasure: ReturnType<typeof weeklyMeasureFor>;
};

export async function loadWorkflowView(actor: TmsActor, courseId: string): Promise<TmsWorkflowView> {
  const course = await scopedCourse(actor, courseId);
  const [row, payer, rules, providerRows, auth, defaults, baselineScores] = await Promise.all([
    prisma.tmsCaseWorkflow.findUnique({ where: { courseId: course.id } }),
    clientPayer(actor.organizationId, course.clientId),
    loadPayerRules(actor.organizationId),
    prisma.user.findMany({
      where: { organizationId: actor.organizationId, status: 'ACTIVE', ...PRESCRIBER_WHERE },
      select: { id: true, name: true, role: true, roles: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
    prisma.priorAuth.findFirst({
      where: { organizationId: actor.organizationId, clientId: course.clientId, status: 'APPROVED', cptCodes: { hasSome: TMS_CPTS } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, authNumber: true, unitsApproved: true, startDate: true, endDate: true },
    }),
    loadPracticeDefaults(actor.organizationId),
    prisma.tmsPhq9.findMany({ where: { courseId: course.id, milestone: 'baseline' }, select: { instrument: true, score: true } }).catch(() => [] as { instrument: string; score: number }[]),
  ]);
  const providers = providerRows.map((p) => ({ ...p, kind: providerKindForUser(p) }));
  const evaluation = (row?.evaluation && typeof row.evaluation === 'object' ? row.evaluation : {}) as TmsEvaluation;
  const packet = (row?.packet && typeof row.packet === 'object' ? row.packet : {}) as TmsPacket;
  const matched = matchPayerRules(payer, rules);
  const ordering = providers.find((p) => p.id === row?.orderingProviderId) ?? null;
  const prescriber = checkPrescriber(matched, ordering ? ordering.kind : null);
  const indication = row?.indication === 'mdd' || row?.indication === 'ocd' ? row.indication : null;
  // Authorization recorded by billing; an approved TMS prior auth on file fills the count when billing left it blank
  const authorizedSessions = row?.authorizedSessions ?? (auth?.unitsApproved && auth.unitsApproved > 0 ? auth.unitsApproved : null);
  const authStatus = row?.authStatus ?? (auth ? 'approved' : null);
  // No referral: the medication management visit that completes the TMS intake documents (linked, or
  // the client's medication management visit booked since the case opened)
  const medMgmt = row?.medMgmtAppointmentId
    ? await prisma.appointment.findFirst({ where: { id: row.medMgmtAppointmentId, clientId: course.clientId }, select: { id: true, startsAt: true } })
    : row?.referralSource === 'none'
      ? await prisma.appointment.findFirst({
          where: { clientId: course.clientId, type: { contains: 'Medication Management', mode: 'insensitive' }, createdAt: { gte: course.createdAt }, status: { notIn: ['CANCELLED', 'LATE_CANCEL', 'NO_SHOW'] } },
          orderBy: { startsAt: 'asc' },
          select: { id: true, startsAt: true },
        })
      : null;
  const deviceFromPracticeDefault = !row?.deviceName && Boolean(defaults.deviceName);
  const deviceName = row?.deviceName ?? defaults.deviceName ?? null;
  const deviceDetail = row?.deviceDetail ?? (deviceFromPracticeDefault ? defaults.deviceDetail : null) ?? null;
  const failedTrials = countAdtTrials(course.adtTrialsJson);
  const payerMinimum = payerMinFailedTrials(matched);
  const absolute = absoluteContraindications(course.screeningJson);
  const criteria = criteriaChecklist({
    evaluation,
    indication,
    ageYears: ageYearsFrom(course.client.dateOfBirth),
    failedTrials,
    payerMinimum,
    baselineScores,
    absoluteContraindications: absolute,
  });
  const incomplete = criteriaIncomplete(criteria);
  const criteriaRequired = matched.some((m) => m.rule === 'plan_specific');
  const startBlockers = startCourseBlockers({
    evaluation,
    indication,
    deviceName,
    deviceClearedForIndication: row?.deviceClearedForIndication,
    criteriaIncomplete: incomplete,
    criteriaRequired,
    authStatus,
    prescriber,
    payerVerified: row?.payerVerified,
    payerVerifyNote: row?.payerVerifyNote,
    absoluteContraindications: absolute,
  });
  return {
    courseId: course.id,
    clientId: course.clientId,
    stage: row && isTmsStage(row.stage) ? row.stage : 'referral',
    stageEnteredAt: (row?.stageEnteredAt ?? course.createdAt).toISOString(),
    stageHistory: history(row).length ? history(row) : [{ stage: 'referral', at: course.createdAt.toISOString() }],
    ownerId: row?.ownerId ?? null,
    ownerName: row?.ownerName ?? null,
    referralSource: row?.referralSource === 'external' || row?.referralSource === 'none' ? row.referralSource : null,
    referringProvider: row?.referringProvider ?? null,
    packet,
    packetMissing: packetMissing(packet),
    medMgmtAppointment: medMgmt ? { id: medMgmt.id, startsAt: medMgmt.startsAt.toISOString() } : null,
    insuranceSentAt: row?.insuranceSentAt?.toISOString() ?? null,
    verificationStatus: row?.verificationStatus ?? null,
    authStatus,
    authorizedSessions,
    billingNote: row?.billingNote ?? null,
    priorAuth: auth
      ? { id: auth.id, authNumber: auth.authNumber, unitsApproved: auth.unitsApproved, startDate: auth.startDate?.toISOString().slice(0, 10) ?? null, endDate: auth.endDate?.toISOString().slice(0, 10) ?? null }
      : null,
    indication,
    deviceName,
    deviceDetail,
    deviceFromPracticeDefault,
    practiceDevice: defaults,
    deviceClearedForIndication: row?.deviceClearedForIndication ?? null,
    orderingProviderId: row?.orderingProviderId ?? null,
    payerVerified: row?.payerVerified ?? null,
    payerVerifyNote: row?.payerVerifyNote ?? null,
    evaluation,
    scheduledSessions: row?.scheduledSessions ?? null,
    seriesIds: row?.seriesIds ?? [],
    measureAssignmentId: row?.measureAssignmentId ?? null,
    payer,
    matchedRules: matched.map((m) => ({ payerKey: m.payerKey, payerLabel: m.payerLabel, rule: m.rule, minFailedTrials: m.minFailedTrials ?? null, hint: payerRuleHint(m.payerKey) })),
    prescriber,
    startBlockers,
    criteria,
    criteriaIncomplete: incomplete,
    criteriaRequired,
    failedTrials,
    payerMinimum,
    targetSessions: courseTargetSessions({ targetSessions: course.targetSessions, scheduledSessions: row?.scheduledSessions, authorizedSessions }),
    consentHref: tmsConsentHref(course.clientId),
    defaultSessions: defaultSessionCount(authorizedSessions),
    providers: providers.map((p) => ({ id: p.id, name: p.name || 'Provider', role: p.role, kind: p.kind === 'psychiatrist' ? ('psychiatrist' as const) : ('np' as const) })),
    weeklyMeasure: weeklyMeasureFor(indication),
  };
}

// ─── Updates ─────────────────────────────────────────────────────────────────

export type WorkflowPatch = {
  stage?: TmsStage;
  ownerId?: string | null;
  referralSource?: 'external' | 'none' | null;
  referringProvider?: string | null;
  packet?: TmsPacket;
  medMgmtAppointmentId?: string | null;
  indication?: TmsIndication | null;
  deviceName?: string | null;
  deviceDetail?: string | null;
  deviceClearedForIndication?: boolean | null;
  orderingProviderId?: string | null;
  payerVerified?: boolean | null;
  payerVerifyNote?: string | null;
  evaluation?: TmsEvaluation;
};

/** Stages that need the start blockers cleared first (the course is booked by scheduleCourse). */
const GATED_STAGES: TmsStage[] = ['scheduled'];

function withStage(row: WorkflowRow | null, stage: TmsStage, actor: { userId: string; name?: string | null }, now: Date) {
  const h = history(row);
  return { stage, stageEnteredAt: now, stageHistory: [...h, { stage, at: now.toISOString(), byId: actor.userId, byName: actor.name ?? null }] as object };
}

/** Changed field names (for the audit: names only, never values). */
export function changedFields(patch: Record<string, unknown>): string[] {
  return Object.keys(patch).filter((k) => patch[k] !== undefined);
}

export async function patchWorkflow(actor: TmsActor, courseId: string, patch: WorkflowPatch) {
  const course = await scopedCourse(actor, courseId);
  const row = await prisma.tmsCaseWorkflow.findUnique({ where: { courseId: course.id } });
  const now = new Date();
  const data: Record<string, unknown> = { updatedById: actor.userId };
  if (patch.ownerId !== undefined) {
    if (patch.ownerId) {
      const owner = await prisma.user.findFirst({ where: { id: patch.ownerId, organizationId: actor.organizationId }, select: { id: true, name: true } });
      if (!owner) throw new TmsWorkflowError('Owner not found');
      data.ownerId = owner.id;
      data.ownerName = owner.name;
    } else {
      data.ownerId = null;
      data.ownerName = null;
    }
  }
  if (patch.orderingProviderId !== undefined) {
    if (patch.orderingProviderId) {
      const p = await prisma.user.findFirst({ where: { id: patch.orderingProviderId, organizationId: actor.organizationId, ...PRESCRIBER_WHERE }, select: { id: true } });
      if (!p) throw new TmsWorkflowError('Choose a psychiatrist or NP as the ordering / supervising provider');
    }
    data.orderingProviderId = patch.orderingProviderId || null;
  }
  if (patch.medMgmtAppointmentId !== undefined) {
    if (patch.medMgmtAppointmentId) {
      const a = await prisma.appointment.findFirst({ where: { id: patch.medMgmtAppointmentId, clientId: course.clientId }, select: { id: true } });
      if (!a) throw new TmsWorkflowError('Appointment not found');
    }
    data.medMgmtAppointmentId = patch.medMgmtAppointmentId || null;
  }
  for (const k of ['referralSource', 'referringProvider', 'indication', 'deviceName', 'deviceDetail', 'deviceClearedForIndication', 'payerVerified', 'payerVerifyNote'] as const) {
    if (patch[k] !== undefined) data[k] = typeof patch[k] === 'string' ? (patch[k] as string).trim() || null : patch[k];
  }
  // Prefill the clinic's default device on the case the first time it is saved
  if (!row?.deviceName && patch.deviceName === undefined) {
    const d = await loadPracticeDefaults(actor.organizationId);
    if (d.deviceName) {
      data.deviceName = d.deviceName;
      if (patch.deviceDetail === undefined && !row?.deviceDetail) data.deviceDetail = d.deviceDetail;
    }
  }
  if (patch.packet !== undefined) data.packet = { ...((row?.packet as object) ?? {}), ...patch.packet };
  if (patch.evaluation !== undefined) {
    const prev = (row?.evaluation as TmsEvaluation) ?? {};
    const next: TmsEvaluation = { ...prev, ...patch.evaluation };
    // The determination is the prescriber's: stamped server-side, only a psychiatrist / NP may record it
    if (patch.evaluation.prescriberDetermination !== undefined && patch.evaluation.prescriberDetermination !== prev.prescriberDetermination) {
      if (patch.evaluation.prescriberDetermination && !isTmsPrescriber({ role: actor.role, roles: actor.roles })) {
        throw new TmsWorkflowError('Only a psychiatrist or NP can record the prescriber determination', 403);
      }
      next.determinationBy = patch.evaluation.prescriberDetermination ? actor.name ?? actor.userId : undefined;
      next.determinationAt = patch.evaluation.prescriberDetermination ? now.toISOString() : undefined;
    }
    data.evaluation = next as object;
  }
  if (patch.stage !== undefined && patch.stage !== (row?.stage ?? 'referral')) {
    if (GATED_STAGES.includes(patch.stage)) {
      throw new TmsWorkflowError('Use "Schedule TMS course" to book the course; it checks consent, screening, authorization and the prescriber first.', 409);
    }
    if (patch.stage === 'in_treatment' && row?.stage !== 'scheduled') {
      throw new TmsWorkflowError('Schedule the TMS course first ("Schedule TMS course").', 409);
    }
    if (patch.stage === 'insurance_sent') {
      throw new TmsWorkflowError('Use "Send insurance to billing" so billing gets the hand-off.', 409);
    }
    Object.assign(data, withStage(row, patch.stage, actor, now));
  }
  const saved = await prisma.tmsCaseWorkflow.upsert({
    where: { courseId: course.id },
    create: { courseId: course.id, organizationId: actor.organizationId, clientId: course.clientId, stageHistory: [{ stage: 'referral', at: course.createdAt.toISOString() }], ...data },
    update: data,
  });
  // Ending the case closes the course too
  if (patch.stage === 'completed' || patch.stage === 'discontinued') {
    await prisma.tmsCourse.update({ where: { id: course.id }, data: { status: patch.stage } });
  }
  return { saved, clientId: course.clientId };
}

/** Step 3: insurance information to billing. Billing sees it in To-Do (src/lib/tasks/manage.ts). */
export async function sendToBilling(actor: TmsActor, courseId: string) {
  const course = await scopedCourse(actor, courseId);
  const row = await prisma.tmsCaseWorkflow.findUnique({ where: { courseId: course.id } });
  const payer = await clientPayer(actor.organizationId, course.clientId);
  if (!payer.name && !payer.type) throw new TmsWorkflowError('No insurance on the client’s record: add the insurance before sending it to billing.');
  const now = new Date();
  const data = { ...withStage(row, 'insurance_sent', actor, now), insuranceSentAt: now, insuranceSentById: actor.userId, verificationStatus: 'pending', updatedById: actor.userId };
  await prisma.tmsCaseWorkflow.upsert({
    where: { courseId: course.id },
    create: { courseId: course.id, organizationId: actor.organizationId, clientId: course.clientId, ...data },
    update: data,
  });
  return { clientId: course.clientId };
}

// ─── Billing hand-off ────────────────────────────────────────────────────────

export type BillingHandoff = { courseId: string; clientId: string; clientName: string; payer: string | null; sentAt: string | null; daysWaiting: number | null; packetMissing: number };

/** Open hand-offs (insurance sent, not yet verified) for clients the billing user may see. */
export async function listBillingHandoffs(actor: TmsActor): Promise<BillingHandoff[]> {
  const rows = await prisma.tmsCaseWorkflow.findMany({
    where: { organizationId: actor.organizationId, stage: { in: ['insurance_sent', 'verification'] }, NOT: { verificationStatus: 'verified' } },
    orderBy: { insuranceSentAt: 'asc' },
    take: 100,
  });
  if (!rows.length) return [];
  const clients = await prisma.client.findMany({
    where: { AND: [clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role }), { id: { in: rows.map((r) => r.clientId) } }] },
    select: { id: true, name: true, insurancePayer: true },
  });
  const byId = new Map(clients.map((c) => [c.id, c]));
  const now = Date.now();
  return rows
    .filter((r) => byId.has(r.clientId))
    .map((r) => ({
      courseId: r.courseId,
      clientId: r.clientId,
      clientName: byId.get(r.clientId)!.name,
      payer: byId.get(r.clientId)!.insurancePayer ?? null,
      sentAt: r.insuranceSentAt?.toISOString() ?? null,
      daysWaiting: r.insuranceSentAt ? Math.floor((now - r.insuranceSentAt.getTime()) / 86_400_000) : null,
      packetMissing: packetMissing(r.packet as TmsPacket).length,
    }));
}

/** Step 4: billing records verification + authorization (approved with a count, not required, denied, pending). */
export async function recordVerification(actor: TmsActor, courseId: string, input: { authStatus: 'pending' | 'approved' | 'not_required' | 'denied'; authorizedSessions?: number | null; billingNote?: string | null }) {
  const row = await prisma.tmsCaseWorkflow.findFirst({ where: { courseId, organizationId: actor.organizationId } });
  if (!row) throw new TmsWorkflowError('Hand-off not found', 404);
  const client = await prisma.client.findFirst({
    where: { AND: [{ id: row.clientId }, clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role })] },
    select: { id: true },
  });
  if (!client) throw new TmsWorkflowError('Hand-off not found', 404);
  if (input.authStatus === 'approved' && !(input.authorizedSessions && input.authorizedSessions > 0)) {
    throw new TmsWorkflowError('Enter the number of sessions the payer authorized.');
  }
  const now = new Date();
  const done = input.authStatus !== 'pending';
  const data = {
    authStatus: input.authStatus,
    authorizedSessions: input.authStatus === 'approved' ? input.authorizedSessions : null,
    billingNote: input.billingNote?.trim() || null,
    verificationStatus: done ? 'verified' : 'pending',
    verifiedAt: done ? now : null,
    verifiedById: done ? actor.userId : null,
    updatedById: actor.userId,
    // Verified (approved / not required) moves the case to Evaluation & consent; pending / denied stays in Verification
    ...(row.stage === 'insurance_sent' || row.stage === 'verification'
      ? withStage(row, input.authStatus === 'approved' || input.authStatus === 'not_required' ? 'evaluation' : 'verification', actor, now)
      : {}),
  };
  await prisma.tmsCaseWorkflow.update({ where: { courseId }, data });
  return { clientId: row.clientId };
}

// ─── Schedule course ─────────────────────────────────────────────────────────

export async function scheduleCourse(actor: TmsActor, courseId: string, input: { startDate: string; startTime: string; clinicianId: string; sessions: number; location?: string | null }) {
  const view = await loadWorkflowView(actor, courseId);
  if (view.startBlockers.length) throw new TmsWorkflowError(view.startBlockers[0], 409);
  if (!(input.sessions > 0 && input.sessions <= 200)) throw new TmsWorkflowError('Enter the number of sessions (from the order / authorization).');
  if (view.authStatus === 'approved' && view.authorizedSessions && input.sessions > view.authorizedSessions) {
    throw new TmsWorkflowError(`Only ${view.authorizedSessions} sessions are authorized.`);
  }
  // The scheduled provider must meet the payer rule too
  const provider = view.providers.find((p) => p.id === input.clinicianId);
  if (!provider) throw new TmsWorkflowError('Choose a psychiatrist or NP for the course.');
  const sched = checkPrescriber(matchPayerRules(view.payer, await loadPayerRules(actor.organizationId)), provider.kind);
  if (!sched.ok) throw new TmsWorkflowError(sched.message, 409);

  const chunks = courseSeriesChunks(input.startDate, input.sessions);
  const seriesIds: string[] = [];
  let booked = 0;
  const skipped: { date: string; reason: string }[] = [];
  for (const c of chunks) {
    const r = await createSeries(
      {
        clientId: view.clientId,
        type: 'TMS Treatment',
        clinicianId: provider.id,
        isVirtual: false,
        location: input.location ?? null,
        notes: 'TMS course',
        rule: { frequency: 'weekly', interval: 1, byWeekday: [...TMS_WEEKDAYS], startDate: c.startDate, count: c.count, startTime: input.startTime, durationMinutes: TMS_SESSION_MINUTES },
      } as Parameters<typeof createSeries>[0],
      { id: actor.userId, role: actor.role, organizationId: actor.organizationId }
    );
    if (r.ok === false) {
      if (!seriesIds.length) throw new TmsWorkflowError(r.error, r.status);
      skipped.push({ date: c.startDate, reason: r.error });
      continue;
    }
    seriesIds.push(r.seriesId);
    booked += r.created.length;
    for (const s of r.skipped) skipped.push({ date: s.date, reason: s.reason });
  }

  // Weekly outcome measure through the MBC schedule (PHQ-9 for MDD); an open one is kept as is
  let measureAssignmentId: string | null = view.measureAssignmentId;
  let measureNote = view.weeklyMeasure.note;
  if (view.weeklyMeasure.instrumentId && !measureAssignmentId) {
    const instrumentId = view.weeklyMeasure.instrumentId;
    const existing = await prisma.measureAssignment.findFirst({
      where: { organizationId: actor.organizationId, clientId: view.clientId, instrumentId, status: 'active' },
      select: { id: true, everyDays: true },
    });
    if (existing) {
      measureAssignmentId = existing.id;
      if (existing.everyDays !== 7) measureNote = `${view.weeklyMeasure.label} is already scheduled for this client (every ${existing.everyDays ?? '—'} days); change it to weekly on the Measures page if needed.`;
    } else {
      const m = await prisma.measureAssignment.create({
        data: {
          organizationId: actor.organizationId,
          clientId: view.clientId,
          instrumentId,
          schedule: 'interval',
          everyDays: 7,
          startDate: new Date(`${clinicDate(new Date())}T00:00:00Z`),
          source: 'program',
          sourceRef: `tms:${courseId}`,
          status: 'active',
          activeKey: activeKeyFor(view.clientId, instrumentId),
          assignedById: actor.userId,
        },
      });
      measureAssignmentId = m.id;
    }
  }

  const row = await prisma.tmsCaseWorkflow.findUnique({ where: { courseId } });
  await prisma.tmsCaseWorkflow.upsert({
    where: { courseId },
    create: { courseId, organizationId: actor.organizationId, clientId: view.clientId, ...withStage(null, 'scheduled', actor, new Date()), scheduledProviderId: provider.id, scheduledSessions: input.sessions, seriesIds, measureAssignmentId, updatedById: actor.userId },
    update: { ...withStage(row, 'scheduled', actor, new Date()), scheduledProviderId: provider.id, scheduledSessions: input.sessions, seriesIds: [...(row?.seriesIds ?? []), ...seriesIds], measureAssignmentId, deviceName: view.deviceName, deviceDetail: view.deviceDetail, updatedById: actor.userId },
  });
  await prisma.tmsCourse.update({ where: { id: courseId }, data: { targetSessions: input.sessions } });
  return { clientId: view.clientId, booked, requested: input.sessions, skipped, seriesIds, measureAssignmentId, measureNote };
}

// ─── Monitoring flags ────────────────────────────────────────────────────────

/** The prescriber to flag: the ordering provider, else the scheduled provider. */
export async function flagRecipient(organizationId: string, courseId: string): Promise<string | null> {
  const row = await prisma.tmsCaseWorkflow.findFirst({ where: { courseId, organizationId }, select: { orderingProviderId: true, scheduledProviderId: true } }).catch(() => null);
  return row?.orderingProviderId ?? row?.scheduledProviderId ?? null;
}

/**
 * After a session is logged: new / worsening suicidal ideation (HIGH) or a PHQ-9 rise of 5+
 * points (MEDIUM) raises a risk alert to the prescriber (Alerts page + Inbox), the existing path.
 * Alert text carries no score history beyond the two numbers compared.
 */
export async function flagSessionConcerns(input: {
  organizationId: string;
  courseId: string;
  clientId: string;
  sessionId: string;
  suicidalIdeation: boolean | null | undefined;
  phq9: number | null | undefined;
  /** Clinician-entered Y-BOCS total (score only) */
  ybocs?: number | null;
}): Promise<{ si: boolean; worsening: boolean }> {
  const recipient = await flagRecipient(input.organizationId, input.courseId);
  let si = false;
  let worsening = false;
  if (input.suicidalIdeation) {
    const r = await createRiskAlert({
      organizationId: input.organizationId,
      clientId: input.clientId,
      type: 'suicidal_ideation',
      severity: 'high',
      source: 'assessment',
      sourceId: input.sessionId,
      clinicianId: recipient,
      description: 'TMS session: new or worsening suicidal ideation reported. Prescriber review required today; follow the escalation plan in the TMS evaluation. Crisis: 988.',
    }).catch(() => null);
    si = Boolean(r && r.ok);
  }
  if (typeof input.phq9 === 'number') {
    const [milestones, sessions] = await Promise.all([
      prisma.tmsPhq9.findMany({ where: { courseId: input.courseId, instrument: 'phq-9' }, orderBy: { recordedAt: 'asc' }, select: { score: true, recordedAt: true } }),
      prisma.tmsSession.findMany({ where: { courseId: input.courseId, phq9: { not: null } }, orderBy: { sessionDate: 'asc' }, select: { phq9: true, sessionDate: true } }),
    ]);
    const series = [
      ...milestones.map((m) => ({ at: m.recordedAt.getTime(), score: m.score })),
      ...sessions.map((x) => ({ at: x.sessionDate.getTime(), score: x.phq9 as number })),
    ].sort((a, b) => a.at - b.at).map((x) => x.score);
    const w = phq9Worsening(series);
    if (w.worse) {
      const r = await createRiskAlert({
        organizationId: input.organizationId,
        clientId: input.clientId,
        type: 'low_mood',
        severity: 'medium',
        source: 'assessment',
        sourceId: input.sessionId,
        clinicianId: recipient,
        description: `TMS course: PHQ-9 rose from ${w.from} to ${w.to} (5 or more points). Prescriber review of the TMS course is recommended.`,
      }).catch(() => null);
      worsening = Boolean(r && r.ok);
    }
  }
  if (typeof input.ybocs === 'number') {
    const rows = await prisma.tmsPhq9.findMany({ where: { courseId: input.courseId, instrument: 'ybocs' }, orderBy: { recordedAt: 'asc' }, select: { score: true } });
    const w = ybocsWorsening(rows.map((x) => x.score));
    if (w.worse) {
      const r = await createRiskAlert({
        organizationId: input.organizationId,
        clientId: input.clientId,
        type: 'symptom_worsening',
        severity: 'medium',
        source: 'assessment',
        sourceId: input.sessionId,
        clinicianId: recipient,
        description: `TMS course: Y-BOCS total rose from ${w.from} to ${w.to} (5 or more points; now ${ybocsSeverity(w.to as number)}). Prescriber review of the TMS course is recommended.`,
      }).catch(() => null);
      worsening = worsening || Boolean(r && r.ok);
    }
  }
  return { si, worsening };
}

/** First session logged on a scheduled course: the case moves to In treatment. */
export async function advanceOnSession(organizationId: string, courseId: string, actorUserId: string): Promise<void> {
  const row = await prisma.tmsCaseWorkflow.findFirst({ where: { courseId, organizationId } }).catch(() => null);
  if (!row || row.stage !== 'scheduled') return;
  const now = new Date();
  await prisma.tmsCaseWorkflow.update({
    where: { courseId },
    data: { ...withStage(row, 'in_treatment', { userId: actorUserId }, now), updatedById: actorUserId },
  });
}
