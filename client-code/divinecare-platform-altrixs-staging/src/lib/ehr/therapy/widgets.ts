/**
 * Text renderers for the therapist-template widgets (session header, treatment plan goal
 * progress, ASAM dimensions, treatment plan goals). The MSE, diagnoses, C-SSRS, safety plan and
 * medication widgets reuse the psychiatry template renderers (psychMedMgmt.ts) unchanged.
 * Pure: no React, no Prisma.
 */
import { ageOn, cptLabel, isoDate } from '@/lib/ehr/psychMedMgmt';
import { SESSION_TYPE_LABELS, suggestTherapyCpt, type TherapySessionType } from '@/lib/ehr/therapy/rules';
import type { GoalProgressEntry, PlanProgress } from '@/lib/ehr/therapy/planHierarchy';

const clean = (v: string | null | undefined) => (v || '').trim();

// ─── Session ────────────────────────────────────────────────────────────────

export type SessionBlockInput = {
  patientName: string | null;
  dateOfBirth: string | null;
  mrn: string | null;
  dateOfService: string;
  providerName: string | null;
  providerRole: string | null;
  providerCredentials: string[];
  providerNpi: string | null;
  location: string;
  visitChosen: boolean;
  telehealth: boolean;
  placeOfService: string;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
  /** Progress notes only */
  sessionType: TherapySessionType | null;
  cptCode: string;
  /** Show the time-rule line (time-based psychotherapy codes) */
  timeRule: boolean;
};

export function renderSessionBlock(s: SessionBlockInput): string {
  const dob = isoDate(s.dateOfBirth);
  const age = ageOn(s.dateOfBirth, s.dateOfService);
  const provider = [clean(s.providerName) || 'Not on file', clean(s.providerRole), s.providerCredentials.filter(Boolean).join(', '), s.providerNpi ? `NPI ${s.providerNpi}` : '']
    .filter(Boolean)
    .join(', ');
  const visit = !s.visitChosen
    ? 'Not selected'
    : s.telehealth
      ? `Telehealth (POS ${s.placeOfService === '02' ? '02 — other than patient home' : '10 — patient home'}, modifier 95)`
      : 'In person (POS 11)';
  const lines = [
    `Patient: ${clean(s.patientName) || 'Not on file'}`,
    `DOB: ${dob ? `${dob}${age != null ? ` (age ${age})` : ''}` : 'None on file'}`,
    `MRN: ${clean(s.mrn) || 'None on file'}`,
    `Date of service: ${s.dateOfService || 'Not entered'}`,
    `Provider: ${provider}`,
    `Location: ${clean(s.location) || 'None on file'}`,
    `Visit type: ${visit}`,
  ];
  if (s.sessionType) lines.push(`Session type: ${SESSION_TYPE_LABELS[s.sessionType]}`);
  if (clean(s.startTime)) lines.push(`Start time: ${clean(s.startTime)}`);
  if (clean(s.endTime)) lines.push(`End time: ${clean(s.endTime)}`);
  lines.push(`Session time: ${s.durationMinutes ? `${s.durationMinutes} min` : 'Not entered'}`);
  lines.push(`Service code: ${s.cptCode ? cptLabel(s.cptCode) : 'Not selected'}`);
  if (s.timeRule) lines.push(`Time rule: ${suggestTherapyCpt(s.durationMinutes, s.sessionType || 'individual').rule}`);
  lines.push('Source: patient demographics from the Altrixs chart; provider from the signed-in user profile.');
  return lines.join('\n');
}

/** Session type written by renderSessionBlock (progress notes), read back for the server rule. */
export function sessionTypeFromText(sessionText: string): TherapySessionType {
  const m = sessionText.match(/^Session type: (.+)$/m);
  const label = m ? m[1].trim() : '';
  const hit = (Object.entries(SESSION_TYPE_LABELS) as [TherapySessionType, string][]).find(([, l]) => l === label);
  return hit ? hit[0] : 'individual';
}

// ─── Treatment plan goal progress (progress note) ───────────────────────────

export const GOAL_PROGRESS = ['Progress made', 'No change', 'Regression'] as const;
export type GoalProgress = (typeof GOAL_PROGRESS)[number];

export type ActivePlanSummary = {
  id: string;
  title: string;
  signedAt: string | null;
  reviewDueAt: string | null;
  goals: {
    id: string;
    text: string;
    objectives: string[];
    /** Progress on the plan (Valant scale), as rated when the plan was written / reviewed */
    progress?: PlanProgress;
    /** Recent ratings from signed progress notes, newest first */
    history?: GoalProgressEntry[];
  }[];
};

/** Per goal: this session's movement, and optionally the overall progress level (Valant scale) */
export type GoalProgressValue = Record<string, { status: GoalProgress | ''; note: string; level?: PlanProgress }>;

export function renderPlanGoals(plan: ActivePlanSummary | null, progress: GoalProgressValue, opts: { planLoaded: boolean }): string {
  if (!opts.planLoaded) return '';
  if (!plan) return 'Active treatment plan: None on file (signing is blocked until a signed treatment plan is active).';
  const lines = [
    `Active treatment plan: ${plan.title}${plan.signedAt ? ` (signed ${isoDate(plan.signedAt)})` : ''}${plan.reviewDueAt ? `; review due ${isoDate(plan.reviewDueAt)}` : ''}`,
  ];
  plan.goals.forEach((g, i) => {
    const p = progress[g.id];
    if (!p || !p.status) return;
    lines.push(`Goal ${i + 1}: ${clean(g.text)} — ${p.status}${p.level ? ` (${p.level})` : ''}${clean(p.note) ? ` — ${clean(p.note)}` : ''}`);
  });
  return lines.join('\n');
}

// ─── ASAM dimensions (decision support only) ────────────────────────────────

export const ASAM_DIMENSIONS = [
  { n: 1, label: 'Acute intoxication / withdrawal potential' },
  { n: 2, label: 'Biomedical conditions & complications' },
  { n: 3, label: 'Emotional, behavioral or cognitive conditions' },
  { n: 4, label: 'Readiness to change' },
  { n: 5, label: 'Relapse / continued use potential' },
  { n: 6, label: 'Recovery / living environment' },
] as const;

export const ASAM_RISK_RATINGS = ['0', '1', '2', '3', '4'] as const;
export const ASAM_RATING_LABELS: Record<string, string> = {
  '0': 'no risk',
  '1': 'mild',
  '2': 'moderate',
  '3': 'significant',
  '4': 'severe',
};

export type AsamValue = Record<number, { rating: string; note: string }>;

/**
 * A starting point for the level of care from the six risk ratings — decision support only;
 * the ASAM Criteria placement is the clinician's call (it is never written into the note as the
 * chosen level). Highest rating 0–1 → Level 1; 2 → consider 2.1; 3 → consider 2.5 / 3.x; 4 →
 * consider 3.7 / 4; Dimension 1 at 3+ also prompts a withdrawal-management assessment.
 */
export function asamSuggestion(v: AsamValue): string | null {
  const ratings = ASAM_DIMENSIONS.map((d) => v[d.n]?.rating).filter((r): r is string => Boolean(r));
  if (ratings.length < ASAM_DIMENSIONS.length) return null;
  const max = Math.max(...ratings.map(Number));
  const base =
    max <= 1
      ? 'Level 1 Outpatient'
      : max === 2
        ? 'consider Level 2.1 Intensive Outpatient'
        : max === 3
          ? 'consider Level 2.5 Partial Hospitalization or Level 3.x residential'
          : 'consider Level 3.7 / 4 (medically monitored or managed)';
  const d1 = Number(v[1]?.rating || 0) >= 3 ? '; Dimension 1 at 3+ — assess for withdrawal management' : '';
  return `${base}${d1}`;
}

export function renderAsam(v: AsamValue): string {
  const lines: string[] = [];
  for (const d of ASAM_DIMENSIONS) {
    const r = v[d.n];
    if (!r || !r.rating) continue;
    lines.push(`Dimension ${d.n} — ${d.label}: ${r.rating} (${ASAM_RATING_LABELS[r.rating] || ''})${clean(r.note) ? ` — ${clean(r.note)}` : ''}`);
  }
  if (!lines.length) return '';
  const s = asamSuggestion(v);
  if (s) lines.push(`Ratings suggest (decision support only, not a placement): ${s}`);
  return lines.join('\n');
}

// ─── Treatment plan goals (treatment plan template) ─────────────────────────

export const INTERVENTION_TYPES = [
  'CBT',
  'DBT skills',
  'Motivational interviewing',
  'Trauma-focused CBT',
  'EMDR',
  'Solution-focused therapy',
  'Family therapy',
  'Play therapy',
  'Psychoeducation',
  'Mindfulness / relaxation',
  'Behavioral activation',
  'Relapse prevention',
  'Supportive therapy',
  'Case management / care coordination',
  'Medication management',
  'Other',
] as const;

export const INTERVENTION_FREQUENCIES = ['Each session', 'Weekly', 'Every 2 weeks', 'Monthly', 'As needed'] as const;

/** Clinic ITP Review form scale used before the Valant scale (read forward by asPlanProgress). */
export const REVIEW_PROGRESS = ['None', 'Minimal', 'Satisfactory'] as const;

export type TpObjective = { text: string; targetDate: string };
export type TpIntervention = { type: string; detail: string; frequency: string; responsible: string };
export type TpGoal = {
  id: string;
  /** Long-term goal in the client's words */
  goal: string;
  objectives: TpObjective[];
  interventions: TpIntervention[];
  /** Progress on the Valant scale (planHierarchy PLAN_PROGRESS); older plans' None / Minimal / Satisfactory are read forward */
  progress: PlanProgress;
  progressNote: string;
};

export function emptyTpGoal(id: string, goal = ''): TpGoal {
  return { id, goal, objectives: [{ text: '', targetDate: '' }], interventions: [{ type: '', detail: '', frequency: '', responsible: '' }], progress: '', progressNote: '' };
}

export function interventionText(iv: TpIntervention): string {
  const type = clean(iv.type) === 'Other' ? clean(iv.detail) || 'Other' : [clean(iv.type), clean(iv.detail)].filter(Boolean).join(': ');
  return [type, clean(iv.frequency), clean(iv.responsible) ? `by ${clean(iv.responsible)}` : ''].filter(Boolean).join(' — ');
}

export function renderTpGoals(goals: TpGoal[], opts: { review: boolean }): string {
  const lines: string[] = [];
  goals
    .filter((g) => clean(g.goal))
    .forEach((g, i) => {
      lines.push(`Goal ${i + 1}: ${clean(g.goal)}`);
      g.objectives
        .filter((o) => clean(o.text))
        .forEach((o, j) => lines.push(`  Objective ${i + 1}.${j + 1}: ${clean(o.text)}${clean(o.targetDate) ? ` (target ${clean(o.targetDate)})` : ' (target date not set)'}`));
      g.interventions.filter((iv) => clean(iv.type) || clean(iv.detail)).forEach((iv) => lines.push(`  Intervention: ${interventionText(iv)}`));
      if (opts.review && g.progress) lines.push(`  Progress since last plan: ${g.progress}${clean(g.progressNote) ? ` — ${clean(g.progressNote)}` : ''}`);
    });
  return lines.join('\n');
}

/** Measurable objective starters (inserted on click; the [___] blanks must be filled before signing). */
export const OBJECTIVE_QUICK_FILLS = [
  'Reduce [___] score from [___] to [___] or below',
  'Use [___] coping skill(s) at least [___] times per week, per self-report',
  'Report [___] or fewer [___] episodes per week',
  'Attend [___]% of scheduled sessions',
  'Identify [___] triggers and a coping response for each',
  'Sleep at least [___] hours on [___] nights per week',
] as const;
