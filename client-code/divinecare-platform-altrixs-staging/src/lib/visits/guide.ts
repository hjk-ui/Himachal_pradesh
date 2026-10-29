/**
 * Assemble a VisitGuide from already-loaded facts (pure; loader.ts does the reads).
 * Steps are filtered by `when` conditions and the viewer's audience; a step is 'done' only when
 * the chart shows it (auto check) or the clinician marked it; note steps start 'not_done' and the
 * editor marks them as sections get text.
 */
import { NOTE_SECTIONS, type NoteType } from '@/lib/ehr/noteTemplates';
import { PROTOCOLS, AUTO_STEP_IDS, type AutoStepId } from './protocols';
import { requirementsFor } from './requirements';
import type { Audience, DueItem, GuideBrief, GuideStep, StepCondition, StepStatus, VisitGuide, VisitKind } from './types';

export type AutoCheck = { done: boolean; detail: string };
export type ChecklistMark = { stepId: string; status: 'done' | 'not_applicable' | 'deferred'; reason: string | null };

export type GuideAssemblyInput = {
  kind: VisitKind;
  resolvedFrom: string;
  appointmentId: string | null;
  clientId: string;
  /** null = leadership / unknown: every step shown */
  viewerAudience: Audience | null;
  /** missing condition = false */
  conditions: Partial<Record<StepCondition, boolean>>;
  ageYears: number | null;
  brief: GuideBrief;
  due: DueItem[];
  autoChecks: Partial<Record<AutoStepId, AutoCheck>>;
  marks: ChecklistMark[];
  followUp: { medChange: boolean; elevatedRisk: boolean; nextBooked: string | null };
  /** Codes for this visit when they depend on a practice setting (PRP billing model); default protocol.cpt */
  cpt?: readonly string[];
};

const AUTO = new Set<string>(AUTO_STEP_IDS);

/** Child re-evaluation opens the child template (stored key 'Child Psych Intake' = Valant 46444). */
export function noteTypeFor(kind: VisitKind, ageYears: number | null): string {
  if (kind === 'psych_reeval' && ageYears != null && ageYears < 18) return 'Child Psych Intake';
  return PROTOCOLS[kind].noteType;
}

/** Audience of a staff role (null = leadership: all steps) */
export function audienceForRole(role: string | null | undefined): Audience | null {
  const r = String(role ?? '').toUpperCase();
  if (r === 'PSYCHIATRIST' || r === 'NP') return 'prescriber';
  if (r === 'PHYSICIAN' || r === 'MEDICAL_NP' || r === 'MEDICAL_ASSISTANT') return 'medical';
  if (r === 'PRP_SPECIALIST' || r === 'CASE_MANAGER' || r === 'PEER_SUPPORT') return 'program';
  if (r === 'ADMIN' || r === 'DIRECTOR' || r === 'PRACTICE_DIRECTOR' || r === 'SUPER_ADMIN') return null;
  return 'therapist';
}

export function suggestFollowUp(kind: VisitKind, f: GuideAssemblyInput['followUp']): VisitGuide['followUp'] {
  const base = PROTOCOLS[kind].followUpDays;
  let days = base;
  const reasons: string[] = [base == null ? 'per clinician' : `protocol default ${base} days`];
  if (f.elevatedRisk && (days == null || days > 7)) {
    days = 7;
    reasons.push('shortened to 7 days: elevated risk');
  }
  if (f.medChange && (days == null || days > 14) && ['med_management', 'psych_reeval', 'psych_eval_adult', 'psych_eval_child', 'primary_care'].includes(kind)) {
    days = 14;
    reasons.push('shortened to 14 days: medication change since the last visit');
  }
  return { suggestedDays: days, reason: reasons.join('; '), nextBooked: f.nextBooked };
}

export function assembleGuide(input: GuideAssemblyInput): VisitGuide {
  const protocol = PROTOCOLS[input.kind];
  const noteType = noteTypeFor(input.kind, input.ageYears);
  const sections = new Set<string>((NOTE_SECTIONS as Record<string, readonly string[]>)[noteType as NoteType] ?? []);
  const marks = new Map(input.marks.map((m) => [m.stepId, m]));

  const steps: GuideStep[] = [];
  const seen = new Set<string>();
  for (const { phase, step } of protocol.steps) {
    if (seen.has(step.id)) continue;
    if (step.when && !input.conditions[step.when]) continue;
    if (step.audiences && input.viewerAudience && !step.audiences.includes(input.viewerAudience)) continue;
    seen.add(step.id);
    // A note step whose section the (swapped) template lacks becomes a manual tick
    const s = step.source === 'note' && step.noteSection && !sections.has(step.noteSection) ? { ...step, source: 'manual' as const, noteSection: undefined } : step;
    let status: StepStatus = 'not_done';
    let detail: string | undefined;
    const auto = s.source === 'auto' && AUTO.has(s.id) ? input.autoChecks[s.id as AutoStepId] : undefined;
    const mark = marks.get(s.id);
    if (auto?.done) {
      status = 'done';
      detail = auto.detail;
    } else if (mark) {
      status = mark.status;
      detail = mark.reason ?? (mark.status === 'done' ? 'marked done by clinician' : undefined);
    } else if (auto) {
      detail = auto.detail;
    }
    const out: GuideStep = { ...s, phase, status };
    if (detail) out.detail = detail;
    steps.push(out);
  }

  const basisIds = new Set<string>();
  for (const s of steps) for (const b of s.basis ?? []) basisIds.add(b);
  for (const d of input.due) for (const b of d.basis ?? []) basisIds.add(b);

  const required = steps.filter((s) => s.level === 'required');
  return {
    kind: input.kind,
    label: protocol.label,
    audience: protocol.audience,
    noteType,
    cpt: [...(input.cpt ?? protocol.cpt)],
    appointmentId: input.appointmentId,
    clientId: input.clientId,
    resolvedFrom: input.resolvedFrom,
    brief: input.brief,
    steps,
    due: input.due,
    requirements: requirementsFor(basisIds),
    followUp: suggestFollowUp(input.kind, input.followUp),
    summary: {
      required: required.length,
      requiredDone: required.filter((s) => s.status === 'done' || s.status === 'not_applicable').length,
      dueCount: input.due.filter((d) => d.severity !== 'info').length,
    },
  };
}
