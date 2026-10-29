import { EMPTY_PLAN_CARE, type PlanCare } from '@/lib/ehr/planLibrary';
import { planCareSchema } from '@/lib/ehr/planCareSchema';
import type { Prisma, Role, TreatmentPlan, TreatmentPlanStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { addCalendarDays, clinicDate, validatePlanReviewDate } from '@/lib/workflows/dates';
import { treatmentPlanReviewMaxDays } from '@/lib/practice/clinical-settings';

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

function parseGoals(raw: Prisma.JsonValue | null | undefined): TreatmentPlanGoalsPayload {
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
    startDate: row.createdAt.toISOString().slice(0, 10),
    strengths: row.strengths,
    presentingProblems: row.presentingProblems,
    secondaryDx: goals.secondaryDx ?? null,
    clientSigned: Boolean(goals.clientSigned),
    clinicalDetails: goals.clinicalDetails,
    goals: goals.items,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const planInclude = {
  client: { select: { name: true, dateOfBirth: true } },
  clinician: { select: { name: true } },
} as const;

function goalsToJson(input?: {
  clinicalDetails?: PlanCare;
  items?: TreatmentPlanGoal[];
  secondaryDx?: string | null;
  clientSigned?: boolean;
}): Prisma.InputJsonValue {
  return {
    secondaryDx: emptyToNull(input?.secondaryDx) ?? undefined,
    clientSigned: Boolean(input?.clientSigned),
    clinicalDetails: input?.clinicalDetails ?? { ...EMPTY_PLAN_CARE },
    items: (input?.items ?? []).filter((g) => g.text.trim()),
  };
}

function isMinorDob(dateOfBirth: Date | null | undefined): boolean {
  if (!dateOfBirth) return false;
  const ageYears = (Date.now() - dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return ageYears < 18;
}

async function assertClientInScope(actor: TreatmentPlanActor, clientId: string) {
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      ...clientAccessWhere(actor),
    },
    select: { id: true, dateOfBirth: true },
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

  let clinicianId = emptyToNull(input.clinicianId) ?? actor.actorUserId;
  if (clinicianId) {
    const clinician = await prisma.user.findFirst({
      where: { id: clinicianId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!clinician) clinicianId = actor.actorUserId;
  }

  const maxDays = treatmentPlanReviewMaxDays(isMinorDob(scoped.client.dateOfBirth));
  const review = validatePlanReviewDate(
    input.reviewDueAt ?? addCalendarDays(clinicDate(), Math.min(90, maxDays)),
    new Date(),
    maxDays
  );
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
  if ((existing.status === 'CLOSED' || existing.status === 'EXPIRED') && input.status !== 'ACTIVE') {
    return { ok: false as const, error: 'This archived import is not the plan you edit.', status: 400 as const };
  }

  const currentGoals = parseGoals(existing.goals);
  const data: Prisma.TreatmentPlanUpdateInput = {};

  if (input.title != null) {
    const title = input.title.trim();
    if (!title) {
      return { ok: false as const, error: 'Title is required', status: 400 as const };
    }
    data.title = title;
  }
  if (input.diagnosisCodes) {
    data.diagnosisCodes = input.diagnosisCodes.map((c) => c.trim()).filter(Boolean).slice(0, 12);
  }
  if (input.status) data.status = input.status;
  if (input.reviewDueAt !== undefined) {
    const maxDays = treatmentPlanReviewMaxDays(isMinorDob(existing.client.dateOfBirth));
    const review = validatePlanReviewDate(input.reviewDueAt, new Date(), maxDays);
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
