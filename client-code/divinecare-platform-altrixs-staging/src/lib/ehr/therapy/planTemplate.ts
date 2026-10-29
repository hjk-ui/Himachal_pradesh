/**
 * Treatment Plan template (initial + review): values ⇄ plan text ⇄ TreatmentPlan columns, and the
 * intake → plan pre-fill. Pure (no Prisma / React): the editor renders a preview with it and the
 * server renders the signed snapshot with the same code.
 */
import { renderDiagnoses, type PmmDiagnosis } from '@/lib/ehr/psychMedMgmt';
import { structuredNoteSections } from '@/lib/ehr/noteTemplates';
import { findUnfilledBlanks } from '@/lib/ehr/smartPhrases';
import {
  arrVal,
  missingFields,
  renderSection,
  strVal,
  type TemplateCtx,
  type TextIssue,
  type Values,
} from '@/lib/ehr/therapy/engine';
import { TP, TS, TREATMENT_PLAN_SECTIONS, type TherapyNoteType } from '@/lib/ehr/therapy/sections';
import { TREATMENT_PLAN_TEMPLATE } from '@/lib/ehr/therapy/templates';
import { interventionText, type TpGoal } from '@/lib/ehr/therapy/widgets';
import {
  PROGRESS_PERCENT,
  allGoals,
  carryForward,
  emptyGoal,
  emptyProblem,
  hierarchyBlockers,
  planProblems,
  renderProblems,
  type PlanProblem,
} from '@/lib/ehr/therapy/planHierarchy';

export const TREATMENT_PLAN_TEMPLATE_ID = 'therapy-treatment-plan';
export const TREATMENT_PLAN_TEMPLATE_VERSION = 1;

export type PlanDiagnosis = { code: string; description: string; isPrimary: boolean };

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function planDiagnoses(values: Values): PlanDiagnosis[] {
  const raw = values.diagnoses;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object')
    .map((d) => ({ code: clean(d.code).toUpperCase(), description: clean(d.description), isPrimary: d.isPrimary === true }))
    .filter((d) => d.code || d.description)
    .slice(0, 12);
}

/**
 * Goals in plan order, flattened from the Problem → Goal → Objective → Intervention hierarchy
 * (progress notes, the plan list and the pre-visit brief read goals this way). A goal's
 * interventions are those of all its objectives.
 */
export function planGoals(values: Values): TpGoal[] {
  return allGoals(planProblems(values)).map((g) => ({
    id: g.id,
    goal: g.text,
    objectives: g.objectives.map((o) => ({ text: o.text, targetDate: o.targetDate })),
    interventions: g.objectives.flatMap((o) => o.interventions).map((iv) => ({ type: iv.type, detail: iv.text, frequency: iv.frequency, responsible: iv.responsible })),
    progress: g.progress,
    progressNote: g.progressNote,
  }));
}

export { planProblems };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Plan Start Date (required) / Effective Until, as YYYY-MM-DD or null */
export function planDates(values: Values): { startDate: string | null; effectiveUntil: string | null } {
  const d = (id: string) => (ISO_DAY.test(strVal(values, id)) ? strVal(values, id) : null);
  return { startDate: d('startDate'), effectiveUntil: d('effectiveUntil') };
}

/** Widget texts for the plan sections (diagnoses + goals). */
export function planWidgetTexts(values: Values): Record<string, string> {
  const dx = planDiagnoses(values);
  const pmm: PmmDiagnosis[] = dx.map((d) => ({ ...d, fromChart: false }));
  return {
    diagnoses: dx.length ? renderDiagnoses(pmm).replace(/ \[added this visit\]/g, '') : '',
    tpGoals: renderProblems(planProblems(values)),
  };
}

export function renderPlanSections(values: Values, ctx: TemplateCtx): Record<string, string> {
  const widgets = planWidgetTexts(values);
  const out: Record<string, string> = {};
  for (const s of TREATMENT_PLAN_TEMPLATE) out[s.heading] = renderSection(s, values, ctx, widgets);
  return out;
}

export type PlanHeader = { clientName: string; dateOfBirth: string | null; age: number | null; planDate: string; clinicianName: string | null };
/** Primary header of the plan document (Valant template: "Treatment Plan") */
export const PLAN_PRIMARY_HEADER = 'Treatment Plan';

/** Whole plan as text (one heading per section). This is what gets signed and shown to the patient. */
export function renderTreatmentPlanText(values: Values, ctx: TemplateCtx, header: PlanHeader): string {
  const sections = renderPlanSections(values, ctx);
  const head = [
    PLAN_PRIMARY_HEADER,
    `Patient: ${header.clientName}${header.dateOfBirth ? ` (DOB ${header.dateOfBirth}${header.age != null ? `, age ${header.age}` : ''})` : ''}`,
    `Plan date: ${header.planDate}`,
    `Provider: ${header.clinicianName || 'Not on file'}`,
  ].join('\n');
  const body = TREATMENT_PLAN_SECTIONS.map((h) => `${h}\n${sections[h] || ''}`.trim()).join('\n\n');
  return `${head}\n\n${body}`;
}

/** Why the plan cannot be signed yet (empty = can sign). Read from the rendered text like the note rules. */
export function treatmentPlanBlockers(values: Values, ctx: TemplateCtx): TextIssue[] {
  const sections = renderPlanSections(values, ctx);
  const { required } = missingFields(TREATMENT_PLAN_TEMPLATE, (h) => sections[h] || '', ctx);
  const out = [...required];
  const { startDate, effectiveUntil } = planDates(values);
  if (startDate && effectiveUntil && effectiveUntil < startDate) {
    out.push({ message: `${TP.details}: Effective Until (${effectiveUntil}) is before the Start Date (${startDate}).`, heading: TP.details });
  }
  for (const message of hierarchyBlockers(planProblems(values), { review: strVal(values, 'planKind') === 'Review', startDate })) {
    out.push({ message, heading: TP.goals });
  }
  for (const h of TREATMENT_PLAN_SECTIONS) {
    const blanks = findUnfilledBlanks(sections[h] || '');
    if (blanks) out.push({ message: `${h}: fill ${blanks} [___] blank${blanks === 1 ? '' : 's'}.`, heading: h });
  }
  return out;
}

/** Columns + goals JSON written to TreatmentPlan from the template values. */
export function planFieldsFromValues(values: Values) {
  const dx = planDiagnoses(values);
  const goals = planGoals(values).filter((g) => g.goal);
  const kind = strVal(values, 'planKind') === 'Review' ? 'REVIEW' : 'INITIAL';
  const sudDx = dx.some((d) => /^F1\d/.test(d.code));
  return {
    planKind: kind as 'INITIAL' | 'REVIEW',
    diagnosisCodes: dx.map((d) => d.code).filter(Boolean),
    presentingProblems: strVal(values, 'presentingNeeds') || null,
    strengths: strVal(values, 'tpStrengths') || null,
    secondaryDx: dx.filter((d) => !d.isPrimary).map((d) => [d.code, d.description].filter(Boolean).join(' ')).join('; ') || null,
    reviewDate: /^\d{4}-\d{2}-\d{2}$/.test(strVal(values, 'reviewDate')) ? strVal(values, 'reviewDate') : null,
    clinicalDetails: {
      planType: sudDx ? ('Substance Use Disorder (SUD)' as const) : ('Individual Therapy' as const),
      levelOfCare: (['Outpatient', 'Intensive Outpatient', 'Partial Hospitalization', 'Community-based'].includes(strVal(values, 'tpLevelOfCare'))
        ? strVal(values, 'tpLevelOfCare')
        : 'Outpatient') as 'Outpatient',
      asamLevel: '' as const,
      serviceFrequency: strVal(values, 'tpFrequency') as '',
      expectedDuration: '' as const,
      coordinationOfCare: strVal(values, 'tpReferrals'),
      barriersToTreatment: strVal(values, 'tpWeaknesses'),
    },
    goals: goals.map((g) => ({
      id: g.id,
      text: g.goal,
      targetDate: g.objectives.map((o) => o.targetDate).filter(Boolean).sort().pop() || '',
      objectives: g.objectives.filter((o) => o.text).map((o) => `${o.text}${o.targetDate ? ` (target ${o.targetDate})` : ''}`),
      interventions: g.interventions.filter((iv) => iv.type || iv.detail).map(interventionText),
      progress: PROGRESS_PERCENT[g.progress] ?? 0,
    })),
  };
}

// ─── Pre-fill ───────────────────────────────────────────────────────────────

export type IntakePrefill = {
  noteId: string;
  noteType: TherapyNoteType;
  date: string;
  diagnoses: PlanDiagnosis[];
  goals: string[];
  frequency: string;
  presentingProblem: string;
  strengths: string;
  levelOfCare: string;
};

const DX_LINE = /^\d+\.\s+([A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?)\s*(?:—\s*(.*?))?(\s*\(primary\))?(?:\s*\[[^\]]*\])?\s*$/i;

/** What an intake note (MD Therapy Adult & Child Intake / Substance Abuse Intake) gives the plan. */
export function prefillFromIntakeBody(input: { noteId: string; noteType: TherapyNoteType; date: string; body: string }): IntakePrefill {
  const sections = structuredNoteSections(input.noteType, input.body);
  const text = (h: string) => sections.filter((s) => s.title === h).map((s) => s.text).join('\n');
  const line = (h: string, label: string) => {
    const l = text(h)
      .split('\n')
      .find((x) => x.trim().startsWith(`${label}:`));
    return l ? l.trim().slice(label.length + 1).trim() : '';
  };
  const diagnoses: PlanDiagnosis[] = [];
  for (const l of text(TS.diagnoses).split('\n')) {
    const m = l.trim().match(DX_LINE);
    if (m) diagnoses.push({ code: m[1].toUpperCase(), description: (m[2] || '').trim(), isPrimary: Boolean(m[3]) });
  }
  const goals: string[] = [];
  for (const l of text(TS.initialGoals).split('\n')) {
    const m = l.trim().match(/^- Goal: (.+?)(?:; Target: .*)?$/);
    if (m) goals.push(m[1].trim());
  }
  const presenting = (() => {
    const t = text(TS.referral);
    const i = t.indexOf('Presenting problem (client’s words):');
    if (i === -1) return '';
    const rest = t.slice(i + 'Presenting problem (client’s words):'.length).trim();
    return rest.split(/\n(?=[A-Z][^:\n]{2,60}: )/)[0].trim();
  })();
  return {
    noteId: input.noteId,
    noteType: input.noteType,
    date: input.date,
    diagnoses,
    goals,
    frequency: line(TS.recommendations, 'Recommended session frequency'),
    presentingProblem: presenting,
    strengths: line(TS.strengths, 'Strengths'),
    levelOfCare: line(TS.recommendations, 'Recommended level of care'),
  };
}

/** Starting values for a new plan from the intake (initial) or from the current plan (review). */
export function initialPlanValues(input: {
  kind: 'Initial' | 'Review';
  intake: IntakePrefill | null;
  priorValues: Values | null;
  reviewDate: string;
  /** Plan Start Date to start from (the clinician can change it); omitted = left blank */
  startDate?: string | null;
}): Values {
  const startDate = input.startDate && ISO_DAY.test(input.startDate) ? input.startDate : undefined;
  if (input.kind === 'Review' && input.priorValues) {
    const prior = input.priorValues;
    const { tpGoals: _legacy, ...rest } = prior;
    void _legacy;
    return {
      ...rest,
      planKind: 'Review',
      reviewDate: input.reviewDate,
      startDate,
      effectiveUntil: '',
      dxChanged: '',
      tpProgress: '',
      clientParticipated: '',
      caregiverParticipated: '',
      clientAgreed: '',
      copyOffered: '',
      tpParticipation: [],
      // Copied forward from the active plan: progress cleared for re-rating
      tpProblems: carryForward(planProblems(prior)),
    };
  }
  const intake = input.intake;
  const values: Values = { planKind: input.kind, reviewDate: input.reviewDate, ...(startDate ? { startDate } : {}) };
  let problem: PlanProblem;
  if (intake) {
    values.diagnoses = intake.diagnoses;
    if (intake.presentingProblem) values.presentingNeeds = intake.presentingProblem;
    if (intake.strengths) values.tpStrengths = intake.strengths;
    if (['Weekly', 'Bi-weekly', '2x/week', 'Monthly', 'As needed'].includes(intake.frequency)) values.tpFrequency = intake.frequency;
    // The intake's goals (client's words) start one problem; its name is left for the clinician.
    problem = emptyProblem('P1', (intake.goals.length ? intake.goals : ['']).map((g, i) => emptyGoal(`G${i + 1}`, g)));
    if (intake.presentingProblem) problem.patientDescription = intake.presentingProblem;
  } else {
    problem = emptyProblem('P1', [emptyGoal('G1')]);
  }
  values.tpProblems = [problem];
  return values;
}

/** Values saved on the plan (goals JSON `template` key). */
export function templateValuesFromGoalsJson(raw: unknown): Values | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const t = (raw as Record<string, unknown>).template;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const v = (t as Record<string, unknown>).values;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Values) : null;
}

/** Strip anything that is not a known field / shape, and cap sizes (server side). */
export function sanitizePlanValues(raw: unknown): Values {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Values) : {};
  const out: Values = {};
  const cap = (s: string, n = 4000) => s.slice(0, n);
  for (const s of TREATMENT_PLAN_TEMPLATE) {
    for (const f of s.fields) {
      if (f.kind === 'widget') continue;
      if (f.kind === 'multi') {
        const items = arrVal(src, f.id).slice(0, 30).map((x) => cap(x, 200));
        if (items.length) out[f.id] = items;
        const other = strVal(src, `${f.id}__other`);
        if (other) out[`${f.id}__other`] = cap(other, 400);
      } else if (f.kind === 'rows') {
        const v = src[f.id] as { none?: unknown; rows?: unknown } | undefined;
        const rows = Array.isArray(v?.rows) ? (v!.rows as unknown[]) : [];
        out[f.id] = {
          none: v?.none === true,
          rows: rows
            .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
            .slice(0, 20)
            .map((r) => Object.fromEntries(f.columns.map((c) => [c.key, cap(clean(r[c.key]), 300)]))),
        };
      } else {
        const v = strVal(src, f.id);
        if (v) out[f.id] = cap(v);
        const other = strVal(src, `${f.id}__other`);
        if (other) out[`${f.id}__other`] = cap(other, 400);
      }
    }
  }
  for (const id of ['startDate', 'effectiveUntil']) if (out[id] && !ISO_DAY.test(String(out[id]))) delete out[id];
  out.diagnoses = planDiagnoses(src);
  // Problem → Goal → Objective → Intervention (parsed with caps); goals saved flat before are moved in
  out.tpProblems = planProblems(src);
  return out;
}
