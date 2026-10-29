/**
 * Read-only chart context for the structured note editors (Psychiatric Med
 * Management, Child Psychiatry Intake, Child Psychiatry Re-Eval, Adult Psychiatry Intake,
 * Adult Psychiatry Re-Eval).
 * Every value comes from an
 * existing table; nothing is generated. The client must be in the caller's
 * organization and (for caseload roles) caseload.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessLabs } from '@/lib/labs/manage';
import { roleLabel } from '@/lib/auth/userRoles';
import { normalizeNoteType, structuredNoteSections, stripLegacyAddenda } from '@/lib/ehr/noteTemplates';
import {
  PMM,
  PSYCH_MED_MGMT,
  isControlledSubstance,
  safetyPlanToFields,
  type MeasureRecord,
  type PmmAllergy,
  type PmmLabResult,
  type PmmMedication,
  type SafetyPlanFields,
  type NextAppointment,
} from '@/lib/ehr/psychMedMgmt';
import { CHILD_PSYCH_INITIAL_INTAKE, CHILD_PSYCH_INTAKE } from '@/lib/ehr/childPsychIntake';
import { ADULT_PSYCH_INTAKE } from '@/lib/ehr/adultPsychIntake';
import { ADULT_PSYCH_REEVAL } from '@/lib/ehr/adultPsychReEval';
import { priorEvalSourceTypesFor } from '@/lib/ehr/structuredNotes';

export type ContextMedication = PmmMedication & { controlled: boolean; stopDate: string | null; stopReason: string | null };

export type StructuredNoteContext = {
  patient: {
    id: string;
    name: string;
    dateOfBirth: string | null;
    gender: string | null;
    mrn: string | null;
    locationName: string | null;
    primaryDiagnosisCode: string | null;
    primaryDiagnosis: string | null;
    secondaryDiagnoses: string | null;
    /** Emergency contact (not necessarily the legal guardian — guardian is not stored on the chart) */
    emergencyContact: { name: string; relationship: string | null; phone: string | null } | null;
  };
  provider: {
    name: string | null;
    roleLabel: string;
    npi: string | null;
    credentials: string[];
    primaryLocationName: string | null;
  };
  medications: ContextMedication[];
  inactiveMedications: ContextMedication[];
  allergies: PmmAllergy[];
  problems: { code: string; name: string; status: string; onset: string | null }[];
  measures: { available: boolean; records: MeasureRecord[] };
  labs: { available: boolean; results: PmmLabResult[] };
  nextAppointment: NextAppointment;
  /** Most recent med-management note (Psych Med Mgmt or Med Mgmt) */
  lastVisit: {
    noteId: string;
    noteType: string;
    dateOfService: string | null;
    createdAt: string;
    clinicianName: string | null;
    status: string;
    plan: string;
    medChanges: string;
  } | null;
  /** Most recent note of the requested type: section texts for "Bring forward" */
  priorSameType: { noteId: string; date: string; status: string; sections: Record<string, string> } | null;
  /** Most recent psychiatric evaluation (child/adult intake, psych eval or intake): diagnoses + plan for reference */
  priorEval: { noteId: string; noteType: string; date: string; diagnoses: string; plan: string } | null;
  /**
   * Re-evaluations (and the child initial intake's "consider re-eval" hint): the most recent
   * SIGNED prior evaluation of the template's source types (adult: Adult Psychiatry Intake /
   * Re-Eval, Psych Eval, Intake; child: Child Psychiatry Intake / Re-Eval, Psych Eval, Intake).
   * Read-only reference (diagnoses, plan, med changes) and the source of "Bring forward";
   * null when none exists or the template has no prior-evaluation lookup.
   */
  reEvalSource: {
    noteId: string;
    noteType: string;
    date: string;
    status: string;
    diagnoses: string;
    plan: string;
    medChanges: string;
    sections: Record<string, string>;
  } | null;
  safetyPlan: {
    matchedBy: 'clientId' | 'name';
    lastUpdated: string | null;
    lastReviewed: string | null;
    fields: SafetyPlanFields;
  } | null;
};

type Actor = { organizationId: string; actorUserId: string; actorRole: Role };

const MED_MGMT_TYPES = new Set<string>([PSYCH_MED_MGMT, 'Med Mgmt']);
const EVAL_TYPES = new Set<string>([CHILD_PSYCH_INITIAL_INTAKE, CHILD_PSYCH_INTAKE, ADULT_PSYCH_INTAKE, ADULT_PSYCH_REEVAL, 'Psych Eval', 'Intake']);
const SIGNED_STATUSES = new Set<string>(['SIGNED', 'LOCKED']);
const EVAL_MED_CHANGE_HEADINGS = ['Plan - Med Changes'];
const EVAL_DX_HEADINGS = ['Assessment - Diagnoses', 'Diagnosis', 'Diagnostic Impression'];
const EVAL_PLAN_HEADINGS = ['Plan', 'Treatment Recommendations'];

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => Boolean(v && typeof v === 'object')) : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export async function loadStructuredNoteContext(
  actor: Actor,
  clientId: string,
  opts: { noteType: string; excludeNoteId?: string | null }
): Promise<StructuredNoteContext | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, ...clientAccessWhere(actor) },
    select: {
      id: true,
      name: true,
      dateOfBirth: true,
      gender: true,
      mrn: true,
      primaryDiagnosis: true,
      primaryDiagnosisCode: true,
      secondaryDiagnoses: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      location: { select: { name: true } },
    },
  });
  if (!client) return null;

  const requestedType = normalizeNoteType(opts.noteType || '');
  const canSeeAssessments = canAccessPath(actor.actorRole, '/dashboard/ehr/assessments');
  const canSeeLabs = canAccessLabs(actor.actorRole);
  const now = new Date();

  const [user, meds, allergies, problems, assessmentState, clinicalRecords, labOrders, nextAppt, notes, planState, intake] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: actor.actorUserId },
        select: {
          name: true,
          npi: true,
          primaryLocation: { select: { name: true } },
          staffCredentials: {
            where: { credentialType: { in: ['LICENSE', 'CERTIFICATION'] }, status: { not: 'EXPIRED' } },
            select: { title: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      prisma.clientMedication.findMany({
        where: { clientId: client.id },
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        take: 80,
      }),
      prisma.medicalAllergy.findMany({
        where: { clientId: client.id, NOT: { status: { in: ['Inactive', 'Resolved', 'inactive', 'resolved'] } } },
        orderBy: { createdAt: 'desc' },
        select: { allergen: true, reaction: true, severity: true, status: true },
      }),
      prisma.medicalProblem.findMany({
        where: { clientId: client.id },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 40,
        select: { icd10Code: true, name: true, status: true, onsetDate: true },
      }),
      canSeeAssessments
        ? prisma.clinicModuleState.findUnique({
            where: { organizationId_module: { organizationId: actor.organizationId, module: 'assessments' } },
            select: { data: true },
          })
        : Promise.resolve(null),
      canSeeAssessments
        ? prisma.clinicalAssessmentRecord.findMany({
            where: { organizationId: actor.organizationId, clientId: client.id },
            orderBy: { createdAt: 'desc' },
            take: 60,
            select: { instrumentName: true, totalScore: true, severity: true, createdAt: true },
          })
        : Promise.resolve([]),
      canSeeLabs
        ? prisma.labOrder.findMany({
            where: { organizationId: actor.organizationId, clientId: client.id },
            include: { results: { orderBy: { createdAt: 'asc' } } },
            orderBy: [{ orderedAt: 'desc' }],
            take: 15,
          })
        : Promise.resolve([]),
      prisma.appointment.findFirst({
        where: { clientId: client.id, startsAt: { gt: now }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
        orderBy: { startsAt: 'asc' },
        select: { startsAt: true, type: true, isVirtual: true, clinicianName: true, clinician: { select: { name: true } } },
      }),
      prisma.progressNote.findMany({
        where: { clientId: client.id, ...(opts.excludeNoteId ? { id: { not: opts.excludeNoteId } } : {}) },
        include: { clinician: { select: { name: true } }, workflow: { select: { status: true } } },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      prisma.clinicModuleState.findUnique({
        where: { organizationId_module: { organizationId: actor.organizationId, module: 'ehr-safety-plans' } },
        select: { data: true },
      }),
      prisma.intakeInvite.findFirst({
        where: { clientId: client.id, organizationId: actor.organizationId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        select: { formData: true },
      }),
    ]);

  // Measures: clinician-entered assessments (module store) + clinical assessment records
  const records: MeasureRecord[] = [];
  const bucket = asArray(assessmentState?.data).find((b) => b.clientId === client.id);
  for (const item of asArray(bucket?.items)) {
    const score = typeof item.score === 'number' ? item.score : null;
    const date = str(item.date) || str(item.recordedAt);
    if (!str(item.type) || !date) continue;
    records.push({ instrument: str(item.type), score, severity: str(item.severity) || null, date, source: 'Altrixs assessments' });
  }
  for (const r of clinicalRecords) {
    records.push({
      instrument: r.instrumentName,
      score: r.totalScore,
      severity: r.severity,
      date: r.createdAt.toISOString(),
      source: 'Altrixs clinical assessment records',
    });
  }

  const labs: PmmLabResult[] = [];
  for (const o of labOrders) {
    for (const r of o.results) {
      labs.push({
        id: r.id,
        testName: r.testName,
        value: r.value,
        unit: r.unit,
        refRange: r.refRange,
        flag: r.flag,
        date: (o.resultedAt || r.createdAt || o.orderedAt).toISOString(),
      });
    }
  }

  // Prior notes (never Part 2 notes)
  let lastVisit: StructuredNoteContext['lastVisit'] = null;
  let priorSameType: StructuredNoteContext['priorSameType'] = null;
  let priorEval: StructuredNoteContext['priorEval'] = null;
  let reEvalSource: StructuredNoteContext['reEvalSource'] = null;
  const reEvalTypes = priorEvalSourceTypesFor(requestedType);
  const reEvalSources = new Set<string>(reEvalTypes || []);
  const wantReEval = Boolean(reEvalTypes);
  for (const n of notes) {
    if (n.part2) continue;
    const meta = resolveNoteMeta(n);
    const type = normalizeNoteType(meta.noteType || '');
    const needLast = !lastVisit && MED_MGMT_TYPES.has(type);
    const needSame = !priorSameType && type === requestedType;
    const needEval = !priorEval && EVAL_TYPES.has(type);
    const status = n.workflow?.status ?? 'DRAFT';
    const needReEval = wantReEval && !reEvalSource && reEvalSources.has(type) && SIGNED_STATUSES.has(status);
    if (!needLast && !needSame && !needEval && !needReEval) continue;
    const sections = structuredNoteSections(type, stripLegacyAddenda(meta.displayBody));
    const pick = (titles: string[]) =>
      sections
        .filter((s) => titles.includes(s.title))
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join('\n');
    const date = meta.dateOfService || n.createdAt.toISOString().slice(0, 10);
    const sectionMap = () => {
      const map: Record<string, string> = {};
      for (const s of sections) if (s.text.trim()) map[s.title] = map[s.title] ? `${map[s.title]}\n${s.text.trim()}` : s.text.trim();
      return map;
    };
    if (needLast) {
      lastVisit = {
        noteId: n.id,
        noteType: type,
        dateOfService: meta.dateOfService,
        createdAt: n.createdAt.toISOString(),
        clinicianName: n.clinician?.name ?? null,
        status,
        plan: pick([PMM.plan]),
        medChanges: type === PSYCH_MED_MGMT ? pick([PMM.medChanges]) : '',
      };
    }
    if (needSame) {
      priorSameType = { noteId: n.id, date, status, sections: sectionMap() };
    }
    if (needEval) {
      priorEval = { noteId: n.id, noteType: type, date, diagnoses: pick(EVAL_DX_HEADINGS), plan: pick(EVAL_PLAN_HEADINGS) };
    }
    if (needReEval) {
      reEvalSource = {
        noteId: n.id,
        noteType: type,
        date,
        status,
        diagnoses: pick(EVAL_DX_HEADINGS),
        plan: pick(EVAL_PLAN_HEADINGS),
        medChanges: pick(EVAL_MED_CHANGE_HEADINGS),
        sections: sectionMap(),
      };
    }
    if (lastVisit && priorSameType && priorEval && (!wantReEval || reEvalSource)) break;
  }

  // Safety plan (Stanley-Brown module store). Plans store clientId when created after
  // this change; older plans only carry the client's name.
  let safetyPlan: StructuredNoteContext['safetyPlan'] = null;
  const plans = asArray(planState?.data);
  const byId = plans.find((p) => p.clientId === client.id);
  const byName = byId
    ? undefined
    : plans.find((p) => !p.clientId && str(p.clientName).toLowerCase() === client.name.trim().toLowerCase());
  const plan = byId || byName;
  if (plan) {
    safetyPlan = {
      matchedBy: byId ? 'clientId' : 'name',
      lastUpdated: str(plan.lastUpdated) || null,
      lastReviewed: str(plan.lastReviewed) || null,
      fields: safetyPlanToFields(plan as Parameters<typeof safetyPlanToFields>[0]),
    };
  }

  const demographics = (intake?.formData && typeof intake.formData === 'object' && !Array.isArray(intake.formData)
    ? (intake.formData as Record<string, unknown>).demographics
    : null) as Record<string, unknown> | null;
  const emergencyName = client.emergencyContactName?.trim() || str(demographics?.emergencyContactName);
  const emergencyContact = emergencyName
    ? {
        name: emergencyName,
        relationship: str(demographics?.emergencyContactRelationship) || null,
        phone: client.emergencyContactPhone?.trim() || str(demographics?.emergencyContactPhone) || null,
      }
    : null;

  const toMed = (m: (typeof meds)[number]): ContextMedication => {
    const name = (m.drugName || m.medicationName || '').trim() || m.medicationName;
    return {
      id: m.id,
      name,
      dosage: m.dosageText || m.dosage || null,
      route: m.route,
      frequency: m.frequency,
      asNeeded: m.asNeeded,
      prnReason: m.prnReason,
      schedule: m.schedule,
      drFirst: Boolean(m.rcopiaMedId) || m.source === 'drfirst',
      startDate: m.startDate ? m.startDate.toISOString() : null,
      stopDate: (m.stopDate || m.endDate)?.toISOString() ?? null,
      stopReason: m.stopReason,
      controlled: isControlledSubstance(`${name} ${m.genericName || ''} ${m.brandName || ''}`, m.schedule),
    };
  };

  return {
    patient: {
      id: client.id,
      name: client.name,
      dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString() : null,
      gender: client.gender,
      mrn: client.mrn,
      locationName: client.location?.name ?? null,
      primaryDiagnosisCode: client.primaryDiagnosisCode,
      primaryDiagnosis: client.primaryDiagnosis,
      secondaryDiagnoses: client.secondaryDiagnoses,
      emergencyContact,
    },
    provider: {
      name: user?.name ?? null,
      roleLabel: roleLabel(actor.actorRole),
      npi: user?.npi ?? null,
      credentials: [...new Set((user?.staffCredentials || []).map((c) => c.title.trim()).filter(Boolean))],
      primaryLocationName: user?.primaryLocation?.name ?? null,
    },
    medications: meds.filter((m) => m.active).map(toMed),
    inactiveMedications: meds.filter((m) => !m.active).slice(0, 30).map(toMed),
    allergies: allergies.map((a) => ({ allergen: a.allergen, reaction: a.reaction, severity: a.severity, status: a.status })),
    problems: problems.map((p) => ({
      code: p.icd10Code,
      name: p.name,
      status: p.status,
      onset: p.onsetDate ? p.onsetDate.toISOString().slice(0, 10) : null,
    })),
    measures: { available: canSeeAssessments, records },
    labs: { available: canSeeLabs, results: labs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30) },
    nextAppointment: nextAppt
      ? {
          startsAt: nextAppt.startsAt.toISOString(),
          type: nextAppt.type,
          isVirtual: nextAppt.isVirtual,
          clinicianName: nextAppt.clinician?.name || nextAppt.clinicianName || null,
        }
      : null,
    lastVisit,
    priorSameType,
    priorEval,
    reEvalSource,
    safetyPlan,
  };
}
