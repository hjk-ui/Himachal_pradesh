/**
 * Therapist / counselor templates (requested by the clinical director): note-type keys,
 * labels (exactly as the clinic names them) and section headings.
 *
 * No imports on purpose: noteTemplates.ts reads these lists, and the template
 * definitions (./templates.ts) read noteTemplates indirectly, so keeping this file
 * dependency-free avoids an import cycle.
 */

export const THERAPY_INTAKE = 'Therapy Intake' as const;
export const SUD_INTAKE = 'Substance Abuse Intake' as const;
export const THERAPY_PROGRESS = 'Therapy Progress' as const;

export const THERAPY_NOTE_TYPES = [THERAPY_INTAKE, SUD_INTAKE, THERAPY_PROGRESS] as const;
export type TherapyNoteType = (typeof THERAPY_NOTE_TYPES)[number];

/** Names exactly as the clinical director listed them (shown in the New Note dropdown). */
export const THERAPY_NOTE_LABELS: Record<TherapyNoteType, string> = {
  [THERAPY_INTAKE]: 'MD Therapy Adult & Child Intake',
  [SUD_INTAKE]: 'Substance Abuse Intake',
  [THERAPY_PROGRESS]: 'Therapy Progress Adult & Child',
};

/** The fourth template is the treatment plan (stored as a TreatmentPlan, not a progress note). */
export const TREATMENT_PLAN_TEMPLATE_LABEL = 'Treatment Plan';

/**
 * Other names the same templates go by (Valant names as the clinic wrote them, and the
 * descriptive names used in the build request). normalizeNoteType maps all of them to the key.
 * The exact Valant template titles are not confirmed (no Valant access) — see docs/therapist-templates.md.
 */
export const THERAPY_NOTE_ALIASES: Record<TherapyNoteType, readonly string[]> = {
  [THERAPY_INTAKE]: [
    'MD Therapy Adult & Child Intake',
    'MD Therapy Adult and Child Intake',
    'MD Health - Therapy Adult & Child Intake',
    'Therapy Intake — Adult & Child',
    'Therapy Intake - Adult & Child',
    'Therapy Intake',
  ],
  [SUD_INTAKE]: [
    'Substance Abuse Intake',
    'Substance Use Intake',
    'MD Health - Substance Abuse Intake',
    'SUD Intake',
  ],
  [THERAPY_PROGRESS]: [
    'Therapy Progress Adult & Child',
    'Therapy Progress Adult and Child',
    'Therapy Progress Note — Adult & Child',
    'Therapy Progress Note - Adult & Child',
    'MD Health - Therapy Progress Note',
    'Therapy Progress Note',
    'Therapy Progress',
  ],
};

/**
 * "Identifying Information" section heading, shared by every initial intake / evaluation and
 * re-evaluation template (psychiatry, therapy, SUD). Fields and text: src/lib/ehr/identifyingInfo.ts.
 */
export const IDENTIFYING_INFO = 'Identifying Information' as const;

export const TS = {
  session: 'Session',
  identifying: IDENTIFYING_INFO,
  referral: 'Referral & Presenting Problem',
  hpi: 'History of Present Illness',
  psychHx: 'Psychiatric History',
  substanceScreen: 'Substance Use Screen',
  substanceHx: 'Substance Use History',
  withdrawal: 'Withdrawal & Overdose Risk',
  sudTxHx: 'Substance Use Treatment History',
  screening: 'Screening Scores',
  asam: 'ASAM Dimensions',
  medical: 'Medical History & Medications',
  trauma: 'Trauma & Abuse History',
  familySocial: 'Family & Social History',
  child: 'Child & Adolescent History',
  legal: 'Legal History',
  strengths: 'Strengths & Barriers',
  mse: 'Mental Status Exam',
  risk: 'Risk Assessment',
  diagnoses: 'Diagnostic Impressions',
  part2: '42 CFR Part 2 Consent',
  recommendations: 'Recommendations & Level of Care',
  initialGoals: 'Initial Treatment Goals',
  planGoals: 'Treatment Plan Goals',
  interval: 'Target Symptoms & Interval History',
  interventions: 'Interventions',
  riskCheck: 'Risk Check',
  response: 'Response to Interventions',
  impression: 'Impression',
  planNext: 'Plan & Homework',
  review: 'Review',
} as const;

export const THERAPY_SECTIONS: Record<TherapyNoteType, readonly string[]> = {
  [THERAPY_INTAKE]: [
    TS.session,
    TS.identifying,
    TS.referral,
    TS.hpi,
    TS.psychHx,
    TS.substanceScreen,
    TS.medical,
    TS.trauma,
    TS.familySocial,
    TS.child,
    TS.legal,
    TS.strengths,
    TS.mse,
    TS.risk,
    TS.diagnoses,
    TS.recommendations,
    TS.initialGoals,
    TS.review,
  ],
  [SUD_INTAKE]: [
    TS.session,
    TS.identifying,
    TS.referral,
    TS.hpi,
    TS.substanceHx,
    TS.withdrawal,
    TS.sudTxHx,
    TS.screening,
    TS.asam,
    TS.psychHx,
    TS.medical,
    TS.trauma,
    TS.familySocial,
    TS.child,
    TS.legal,
    TS.strengths,
    TS.mse,
    TS.risk,
    TS.diagnoses,
    TS.part2,
    TS.recommendations,
    TS.initialGoals,
    TS.review,
  ],
  [THERAPY_PROGRESS]: [
    TS.session,
    TS.planGoals,
    TS.interval,
    TS.interventions,
    TS.mse,
    TS.riskCheck,
    TS.response,
    TS.impression,
    TS.planNext,
    TS.review,
  ],
};

export const TP = {
  details: 'Plan Details',
  problems: 'Diagnoses & Problems',
  strengths: 'Strengths & Preferences',
  goals: 'Problems, Goals, Objectives & Interventions',
  services: 'Services & Frequency',
  discharge: 'Discharge & Transition Plan',
  instructions: 'Patient Instructions & Comments',
  reviewDate: 'Next Review',
  participation: 'Client Participation',
} as const;

export const TREATMENT_PLAN_SECTIONS: readonly string[] = [
  TP.details,
  TP.problems,
  TP.strengths,
  TP.goals,
  TP.services,
  TP.discharge,
  TP.instructions,
  TP.reviewDate,
  TP.participation,
];
