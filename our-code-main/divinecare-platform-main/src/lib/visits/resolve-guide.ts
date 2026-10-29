import { prisma } from '@/lib/db/prisma';
import { resolveVisitKind, VISIT_KINDS, type VisitKindId } from './kinds';
import {
  briefForVisitKind,
  MARYLAND_CONFIRMATIONS,
  stepsForVisitKind,
  type GuideLevel,
  type GuidePhase,
  type GuideStepDef,
} from './guide-catalog';

export type ChecklistItemState = {
  key: string;
  label: string;
  phase: GuidePhase;
  level: GuideLevel;
  done: boolean;
  due: boolean;
  action?: GuideStepDef['action'];
  href?: string;
  instrumentName?: string;
  when?: GuideStepDef['when'];
  part2?: boolean;
};

export type VisitGuidePayload = {
  kind: VisitKindId;
  label: string;
  part2: boolean;
  brief: { title: string; summary: string; cpt: string[] };
  checklist: ChecklistItemState[];
  due: ChecklistItemState[];
  requirements: typeof MARYLAND_CONFIRMATIONS;
  /** Sign-time warnings only — never hard-block */
  signWarnings: string[];
  persisted: Array<{
    id: string;
    stepKey: string;
    done: boolean;
    note: string | null;
  }>;
};

function stepApplies(step: GuideStepDef, ctx: { antipsychotic?: boolean; telehealth?: boolean; minor?: boolean; opioidBenzo?: boolean }): boolean {
  if (!step.when || step.when === 'always') return true;
  if (step.when === 'antipsychotic') return Boolean(ctx.antipsychotic);
  if (step.when === 'telehealth') return Boolean(ctx.telehealth);
  if (step.when === 'minor') return Boolean(ctx.minor);
  if (step.when === 'opioid_benzo') return Boolean(ctx.opioidBenzo);
  if (step.when === 'adult') return !ctx.minor;
  if (step.when === 'child') return Boolean(ctx.minor);
  return true;
}

export async function buildVisitGuide(params: {
  organizationId: string;
  clientId?: string | null;
  appointmentId?: string | null;
  kind?: string | null;
  antipsychotic?: boolean;
  telehealth?: boolean;
  minor?: boolean;
  opioidBenzo?: boolean;
}): Promise<VisitGuidePayload> {
  let kindInput = params.kind || null;
  let telehealth = params.telehealth;
  let minor = params.minor;

  if (params.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: { id: params.appointmentId, organizationId: params.organizationId },
      select: { type: true, isVirtual: true, clientId: true },
    });
    if (appt) {
      kindInput = kindInput || appt.type;
      if (telehealth === undefined) telehealth = appt.isVirtual;
    }
  }

  if (params.clientId && minor === undefined) {
    const client = await prisma.client.findFirst({
      where: { id: params.clientId, organizationId: params.organizationId },
      select: { dateOfBirth: true },
    });
    if (client?.dateOfBirth) {
      const ageMs = Date.now() - client.dateOfBirth.getTime();
      const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
      minor = ageYears < 18;
    }
  }

  const kind = resolveVisitKind(kindInput);
  const def = VISIT_KINDS[kind];
  const ctx = {
    antipsychotic: params.antipsychotic,
    telehealth: Boolean(telehealth),
    minor: Boolean(minor),
    opioidBenzo: params.opioidBenzo ?? true,
  };

  const steps = stepsForVisitKind(kind).filter((s) => stepApplies(s, ctx));

  const instrumentNames = steps
    .map((s) => s.instrumentName)
    .filter((n): n is string => Boolean(n));

  const doneByInstrument = new Set<string>();
  if (params.clientId && instrumentNames.length > 0) {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const assessments = await prisma.clinicalAssessmentRecord.findMany({
      where: {
        organizationId: params.organizationId,
        clientId: params.clientId,
        createdAt: { gte: since },
        OR: [
          { instrumentName: { in: instrumentNames } },
          { instrumentId: { in: instrumentNames.map((n) => n.toLowerCase().replace(/\s+/g, '-')) } },
        ],
      },
      select: { instrumentName: true, instrumentId: true },
    });
    for (const row of assessments) {
      if (row.instrumentName) doneByInstrument.add(row.instrumentName.toUpperCase());
      if (row.instrumentId) doneByInstrument.add(row.instrumentId.toUpperCase());
    }
  }

  let persistedRows: Array<{ id: string; stepKey: string; done: boolean; note: string | null }> = [];
  const doneByKey = new Set<string>();
  if (params.clientId) {
    persistedRows = await prisma.visitChecklistItem.findMany({
      where: {
        organizationId: params.organizationId,
        clientId: params.clientId,
        ...(params.appointmentId ? { appointmentId: params.appointmentId } : {}),
        visitKind: kind,
      },
      select: { id: true, stepKey: true, done: true, note: true },
      orderBy: { updatedAt: 'desc' },
    });
    for (const row of persistedRows) {
      if (row.done) doneByKey.add(row.stepKey);
    }
  }

  const checklist: ChecklistItemState[] = steps.map((step) => {
    const instrumentDone = step.instrumentName
      ? doneByInstrument.has(step.instrumentName.toUpperCase()) ||
        doneByInstrument.has(step.instrumentName.toUpperCase().replace(/\s+/g, '-'))
      : false;
    const done = doneByKey.has(step.key) || instrumentDone;
    const due = !done && (step.level === 'required' || Boolean(step.instrumentName));
    return {
      key: step.key,
      label: step.label,
      phase: step.phase,
      level: step.level,
      done,
      due,
      action: step.action,
      href: step.href,
      instrumentName: step.instrumentName,
      when: step.when,
      part2: step.part2,
    };
  });

  const due = checklist.filter((c) => c.due);
  const signWarnings = due
    .filter((c) => c.level === 'required')
    .map((c) => `Required not done: ${c.label}`);

  return {
    kind,
    label: def.label,
    part2: Boolean(def.part2),
    brief: briefForVisitKind(kind),
    checklist,
    due,
    requirements: MARYLAND_CONFIRMATIONS,
    signWarnings,
    persisted: persistedRows,
  };
}

export async function upsertChecklistItem(params: {
  organizationId: string;
  clientId: string;
  appointmentId?: string | null;
  visitKind: VisitKindId;
  stepKey: string;
  done: boolean;
  note?: string | null;
  userId?: string | null;
}) {
  const existing = await prisma.visitChecklistItem.findFirst({
    where: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      visitKind: params.visitKind,
      stepKey: params.stepKey,
      ...(params.appointmentId
        ? { appointmentId: params.appointmentId }
        : { appointmentId: null }),
    },
  });

  if (existing) {
    return prisma.visitChecklistItem.update({
      where: { id: existing.id },
      data: {
        done: params.done,
        note: params.note ?? existing.note,
        completedAt: params.done ? new Date() : null,
        completedById: params.done ? params.userId || null : null,
      },
    });
  }

  return prisma.visitChecklistItem.create({
    data: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      appointmentId: params.appointmentId || null,
      visitKind: params.visitKind,
      stepKey: params.stepKey,
      done: params.done,
      note: params.note || null,
      completedAt: params.done ? new Date() : null,
      completedById: params.done ? params.userId || null : null,
    },
  });
}
