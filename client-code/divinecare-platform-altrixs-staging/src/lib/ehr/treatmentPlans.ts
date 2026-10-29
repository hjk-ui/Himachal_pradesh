import { EMPTY_PLAN_CARE, type PlanCare } from '@/lib/ehr/planLibrary';
import { planCareSchema } from '@/lib/ehr/planCareSchema';
import type { Prisma, Role, TreatmentPlan, TreatmentPlanStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { addCalendarDays, clinicDate, validatePlanReviewDate } from '@/lib/workflows/dates';
import { parsePlanSource, type ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';
import { asPatientSignatureStatus, type PatientSignatureStatus } from '@/lib/ehr/therapy/rules';
import { clientReviewDays } from '@/lib/ehr/therapy/reviewInterval';
import { icd10ErrorText, validateIcd10Codes } from '@/lib/icd10/validate';
import { parseOtherSignatures, type OtherSignature } from '@/lib/ehr/therapy/planDocument';

export const TREATMENT_PLAN_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'NEEDS_REVIEW',
  'EXPIRED',
  'CLOSED',
] as const satisfies readonly TreatmentPlanStatus[];

export type TreatmentPlanGoal = {
  id: string;
  text: string;
  targetDate: string;
  objectives: string[];
  interventions: string[];
  progress: number;
};

export type TreatmentPlanGoalsPayload = {
  secondaryDx?: string;
  clientSigned?: boolean;
  clinicalDetails?: PlanCare;
  items: TreatmentPlanGoal[];
  /** Set when the plan came from a migration import (content stays in the source EHR) */
  source?: ImportedPlanSource | null;
};

export type TreatmentPlanListItem = {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  clinicianId: string | null;
  clinicianName: string;
  title: string;
  diagnosisCodes: string[];
  status: TreatmentPlanStatus;
  reviewDueAt: string | null;
  startDate: string;
  strengths: string | null;
  presentingProblems: string | null;
  secondaryDx: string | null;
  clientSigned: boolean;
  clinicalDetails?: PlanCare;
  goals: TreatmentPlanGoal[];
  /** Imported from Valant: goals, objectives and interventions were not exported */
  source: ImportedPlanSource | null;
  /** INITIAL | REVIEW (Treatment Plan template) */
  planKind: string;
  /** Made with the therapist Treatment Plan template (edit it in the template editor) */
  hasTemplate: boolean;
  /** Plan this one replaces (a review, or the rewrite of an imported Valant plan) */
  supersedesId: string | null;
  signatures: {
    clinicianSignedAt: string | null;
    clinicianSignedByName: string | null;
    supervisorRequired: boolean;
    supervisorSignedAt: string | null;
    supervisorSignedByName: string | null;
    patientStatus: PatientSignatureStatus;
    patientSentAt: string | null;
    patientSignedAt: string | null;
    patientSignedName: string | null;
    patientDeclinedAt: string | null;
    patientDeclineReason: string | null;
    patientVerbalBy: string | null;
    /** Guardian(s), guarantor, other signers and other providers (Valant attestation text each) */
    others: OtherSignature[];
  };
  createdAt: string;
  updatedAt: string;
};

export type TreatmentPlanActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

export function canAccessTreatmentPlans(role: Role | undefined | null) {
  return Boolean(role && canAccessPath(role, '/dashboard/ehr/treatment-plans'));
}

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function parseGoals(raw: Prisma.JsonValue | null | undefined): TreatmentPlanGoalsPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { items: [] };
  }
  const obj = raw as Record<string, unknown>;
  const itemsRaw = Array.isArray(obj.items) ? obj.items : Array.isArray(obj) ? obj : [];
  const items: TreatmentPlanGoal[] = itemsRaw
    .filter((g): g is Record<string, unknown> => Boolean(g) && typeof g === 'object')
    .map((g, i) => ({
      id: typeof g.id === 'string' && g.id ? g.id : `G${i + 1}`,
      text: typeof g.text === 'string' ? g.text : '',
      targetDate: typeof g.targetDate === 'string' ? g.targetDate : '',
      objectives: Array.isArray(g.objectives)
        ? g.objectives.filter((x): x is string => typeof x === 'string')
        : [],
      interventions: Array.isArray(g.interventions)
        ? g.interventions.filter((x): x is string => typeof x === 'string')
        : [],
      progress:
        typeof g.progress === 'number' && Number.isFinite(g.progress)
          ? Math.max(0, Math.min(100, Math.round(g.progress)))
          : 0,
    }));
  const care = planCareSchema.safeParse(obj.clinicalDetails);
  return {
    clinicalDetails: care.success ? care.data : { ...EMPTY_PLAN_CARE },
    secondaryDx: typeof obj.secondaryDx === 'string' ? obj.secondaryDx : undefined,
    clientSigned: obj.clientSigned === true,
    items,
    source: parsePlanSource(obj),
  };
}

function serialize(
  row: TreatmentPlan & {
    client: { name: string };
    clinician: { name: string | null } | null;
  }
): TreatmentPlanListItem {
  const goals = parseGoals(row.goals);
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    clientName: row.client.name,
    clinicianId: row.clinicianId,
    clinicianName: row.clinician?.name || 'Assigned clinician',
    title: row.title,
    diagnosisCodes: row.diagnosisCodes,
    status: row.status,
    reviewDueAt: row.reviewDueAt?.toISOString() ?? null,
    // Imported plans: Valant's start date when the export had one, never the import date
    startDate: goals.source ? goals.source.planStartDate ?? '' : row.createdAt.toISOString().slice(0, 10),
    strengths: row.strengths,
    presentingProblems: row.presentingProblems,
    secondaryDx: goals.secondaryDx ?? null,
    clientSigned: Boolean(goals.clientSigned),
    clinicalDetails: goals.clinicalDetails,
    goals: goals.items,
    source: goals.source ?? null,
    planKind: row.planKind ?? 'INITIAL',
    hasTemplate: hasTemplateValues(row.goals),
    supersedesId: row.supersedesId ?? null,
    signatures: {
      clinicianSignedAt: row.clinicianSignedAt?.toISOString() ?? null,
      clinicianSignedByName: row.clinicianSignedByName ?? null,
      supervisorRequired: Boolean(row.supervisorRequired),
      supervisorSignedAt: row.supervisorSignedAt?.toISOString() ?? null,
      supervisorSignedByName: row.supervisorSignedByName ?? null,
      patientStatus: asPatientSignatureStatus(row.patientSignatureStatus),
      patientSentAt: row.patientSentAt?.toISOString() ?? null,
      patientSignedAt: row.patientSignedAt?.toISOString() ?? null,
      patientSignedName: row.patientSignedName ?? null,
      patientDeclinedAt: row.patientDeclinedAt?.toISOString() ?? null,
      patientDeclineReason: row.patientDeclineReason ?? null,
      patientVerbalBy: row.patientVerbalBy ?? null,
      others: parseOtherSignatures(row.otherSignatures),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Plan saved by the Treatment Plan template (values kept in goals JSON `template`). */
function hasTemplateValues(raw: Prisma.JsonValue | null | undefined): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const t = (raw as Record<string, unknown>).template;
  return Boolean(t && typeof t === 'object' && !Array.isArray(t));
}

const planInclude = {
  client: { select: { name: true } },
  clinician: { select: { name: true } },
} as const;

function goalsToJson(input?: {
  clinicalDetails?: PlanCare;
  items?: TreatmentPlanGoal[];
  secondaryDx?: string | null;
  clientSigned?: boolean;
  source?: ImportedPlanSource | null;
}): Prisma.InputJsonValue {
  return {
    secondaryDx: emptyToNull(input?.secondaryDx) ?? undefined,
    clientSigned: Boolean(input?.clientSigned),
    clinicalDetails: input?.clinicalDetails ?? { ...EMPTY_PLAN_CARE },
    items: (input?.items ?? []).filter((g) => g.text.trim()),
    // Editing an imported plan keeps its import record
    ...(input?.source ? { source: input.source } : {}),
  };
}

async function assertClientInScope(actor: TreatmentPlanActor, clientId: string) {
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      ...clientAccessWhere(actor),
    },
    select: { id: true },
  });
  if (!client) {
    return { ok: false as const, error: 'Client not found', status: 404 as const };
  }
  return { ok: true as const, client };
}

async function findOrgPlan(actor: TreatmentPlanActor, id: string) {
  return prisma.treatmentPlan.findFirst({
    where: {
      id,
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
    include: planInclude,
  });
}

export async function listTreatmentPlans(actor: TreatmentPlanActor, clientId?: string) {
  const rows = await prisma.treatmentPlan.findMany({
    where: {
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
      ...(clientId ? { clientId } : {}),
    },
    include: planInclude,
    orderBy: [{ reviewDueAt: 'asc' }, { createdAt: 'desc' }],
  });
  return rows.map(serialize);
}

export async function getTreatmentPlan(actor: TreatmentPlanActor, id: string) {
  const row = await findOrgPlan(actor, id);
  if (!row) {
    return { ok: false as const, error: 'Treatment plan not found', status: 404 as const };
  }
  return { ok: true as const, plan: serialize(row) };
}

export async function createTreatmentPlan(
  actor: TreatmentPlanActor,
  input: {
    clientId: string;
    title: string;
    diagnosisCodes?: string[];
    status?: TreatmentPlanStatus;
    reviewDueAt?: string | Date | null;
    clinicianId?: string | null;
    strengths?: string | null;
    presentingProblems?: string | null;
    secondaryDx?: string | null;
    clientSigned?: boolean;
    clinicalDetails?: PlanCare;
    goals?: TreatmentPlanGoal[];
  }
) {
  const scoped = await assertClientInScope(actor, input.clientId);
  if (!scoped.ok) {
    return { ok: false as const, error: scoped.error, status: scoped.status };
  }

  const title = input.title.trim();
  if (!title) {
    return { ok: false as const, error: 'Title is required', status: 400 as const };
  }

  const diagnosisCodes = (input.diagnosisCodes ?? [])
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 12);
  const dxCheck = validateIcd10Codes(diagnosisCodes);
  if (!dxCheck.ok) return { ok: false as const, error: icd10ErrorText(dxCheck.errors), status: 400 as const };

  let clinicianId = emptyToNull(input.clinicianId) ?? actor.actorUserId;
  if (clinicianId) {
    const clinician = await prisma.user.findFirst({
      where: { id: clinicianId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!clinician) clinicianId = actor.actorUserId;
  }

  // Same review rule as the template editor: adults <= Practice Settings (max 180), under 18 <= 90
  const interval = await clientReviewDays(actor.organizationId, scoped.client.id);
  const review = validatePlanReviewDate(input.reviewDueAt ?? addCalendarDays(clinicDate(), interval.days), new Date(), interval.days);
  if (!review.ok) return { ok: false as const, error: review.error, status: 400 as const };
  const reviewDueAt = review.date;

  const row = await prisma.treatmentPlan.create({
    data: {
      organizationId: actor.organizationId,
      clientId: scoped.client.id,
      clinicianId,
      title,
      diagnosisCodes,
      status: input.status ?? 'ACTIVE',
      reviewDueAt,
      strengths: emptyToNull(input.strengths),
      presentingProblems: emptyToNull(input.presentingProblems),
      goals: goalsToJson({
        clinicalDetails: input.clinicalDetails,
        items: input.goals,
        secondaryDx: input.secondaryDx,
        clientSigned: input.clientSigned,
      }),
    },
    include: planInclude,
  });

  return { ok: true as const, plan: serialize(row) };
}

export async function updateTreatmentPlan(
  actor: TreatmentPlanActor,
  id: string,
  input: {
    title?: string;
    diagnosisCodes?: string[];
    status?: TreatmentPlanStatus;
    reviewDueAt?: string | Date | null;
    clinicianId?: string | null;
    strengths?: string | null;
    presentingProblems?: string | null;
    secondaryDx?: string | null;
    clientSigned?: boolean;
    clinicalDetails?: PlanCare;
    goals?: TreatmentPlanGoal[];
  }
) {
  const existing = await findOrgPlan(actor, id);
  if (!existing) {
    return { ok: false as const, error: 'Treatment plan not found', status: 404 as const };
  }

  const currentGoals = parseGoals(existing.goals);
  const data: Prisma.TreatmentPlanUpdateInput = {};

  // A signed plan is what the clinician (and patient) signed: content changes go through a
  // reopen (clears signatures) or a Treatment Plan Review. Closing / status changes still work.
  const contentChange = Object.entries(input).some(([k, v]) => v !== undefined && k !== 'status');
  if (contentChange && existing.clinicianSignedAt) {
    return {
      ok: false as const,
      error: 'This plan is signed. Start a Treatment Plan Review, or reopen it from the signature panel (signatures are cleared).',
      status: 409 as const,
    };
  }
  if (contentChange && hasTemplateValues(existing.goals)) {
    return { ok: false as const, error: 'This plan was made with the Treatment Plan template. Edit it in the template editor.', status: 409 as const };
  }

  if (input.title != null) {
    const title = input.title.trim();
    if (!title) {
      return { ok: false as const, error: 'Title is required', status: 400 as const };
    }
    data.title = title;
  }
  if (input.diagnosisCodes) {
    const codes = input.diagnosisCodes.map((c) => c.trim()).filter(Boolean).slice(0, 12);
    // New codes must be in the FY2027 code set; codes already on the plan (e.g. imported) are kept
    const dxCheck = validateIcd10Codes(codes, { skip: existing.diagnosisCodes ?? [] });
    if (!dxCheck.ok) return { ok: false as const, error: icd10ErrorText(dxCheck.errors), status: 400 as const };
    data.diagnosisCodes = codes;
  }
  if (input.status) data.status = input.status;
  if (input.reviewDueAt !== undefined) {
    const interval = await clientReviewDays(actor.organizationId, existing.clientId);
    const review = validatePlanReviewDate(input.reviewDueAt, new Date(), interval.days);
    if (!review.ok) return { ok: false as const, error: review.error, status: 400 as const };
    data.reviewDueAt = review.date;
  }
  if (input.clinicianId !== undefined) {
    const clinicianId = emptyToNull(input.clinicianId);
    if (clinicianId) {
      const clinician = await prisma.user.findFirst({
        where: { id: clinicianId, organizationId: actor.organizationId },
        select: { id: true },
      });
      if (!clinician) {
        return { ok: false as const, error: 'Clinician not found', status: 400 as const };
      }
      data.clinician = { connect: { id: clinician.id } };
    } else {
      data.clinician = { disconnect: true };
    }
  }
  if (input.strengths !== undefined) data.strengths = emptyToNull(input.strengths);
  if (input.presentingProblems !== undefined) {
    data.presentingProblems = emptyToNull(input.presentingProblems);
  }
  if (
    input.clinicalDetails !== undefined ||
    input.goals !== undefined ||
    input.secondaryDx !== undefined ||
    input.clientSigned !== undefined
  ) {
    data.goals = goalsToJson({
      clinicalDetails: input.clinicalDetails ?? currentGoals.clinicalDetails,
      items: input.goals ?? currentGoals.items,
      secondaryDx: input.secondaryDx !== undefined ? input.secondaryDx : currentGoals.secondaryDx,
      clientSigned:
        input.clientSigned !== undefined ? input.clientSigned : currentGoals.clientSigned,
      source: currentGoals.source,
    });
  }

  const row = await prisma.treatmentPlan.update({
    where: { id: existing.id },
    data,
    include: planInclude,
  });
  return { ok: true as const, plan: serialize(row) };
}

export async function closeTreatmentPlan(actor: TreatmentPlanActor, id: string) {
  return updateTreatmentPlan(actor, id, { status: 'CLOSED' });
}
