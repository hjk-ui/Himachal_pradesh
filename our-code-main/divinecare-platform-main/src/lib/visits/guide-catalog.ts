/**
 * Visit Guide checklist catalog + Maryland confirmations — Oct 21 2026 staging parity.
 * Do not invent clinical defaults or confirmation badges.
 */

import type { VisitKindId } from './kinds';
import { VISIT_KINDS } from './kinds';

export type GuidePhase = 'prepare' | 'during' | 'wrap_up';
export type GuideLevel = 'required' | 'recommended' | 'optional';
export type GuideTab = 'brief' | 'checklist' | 'due' | 'requirements';

export type GuideAction =
  | 'assessment'
  | 'drfirst_patient'
  | 'drfirst_medications'
  | 'drfirst_allergies'
  | 'drfirst_message'
  | 'labs'
  | 'safety_plan'
  | 'treatment_plan'
  | 'consents'
  | 'sdoh'
  | 'book_followup'
  | 'pdmp_attest'
  | 'note_section'
  | 'link';

export type GuideWhen = 'always' | 'antipsychotic' | 'telehealth' | 'minor' | 'opioid_benzo' | 'adult' | 'child';

export type GuideStepDef = {
  key: string;
  label: string;
  phase: GuidePhase;
  level: GuideLevel;
  when?: GuideWhen;
  action?: GuideAction;
  href?: string;
  /** Exact instrument name for auto due/done matching (e.g. AIMS) */
  instrumentName?: string;
  part2?: boolean;
};

export type ConfirmationStatus = 'confirmed' | 'confirm_with_compliance' | 'open_numeric';

export type MarylandConfirmation = {
  id: string;
  label: string;
  detail: string;
  status: ConfirmationStatus;
  /** Exact badge text when confirmed */
  badge?: string;
};

export const CONFIRMED_BY_PRACTICE_BADGE = 'Confirmed by practice 2026-10-21';
export const CONFIRM_WITH_COMPLIANCE_BADGE = 'Confirm with compliance';

/** Maryland confirmations — badge text exact per staging snapshot */
export const MARYLAND_CONFIRMATIONS: MarylandConfirmation[] = [
  {
    id: 'md_pdmp',
    label: 'MD PDMP (CRISP) opioid/benzo',
    detail: 'HG §21-2A-04.1; every 90 days',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'epcs',
    label: 'EPCS',
    detail: 'HG §21-220',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'dea_telehealth_cs',
    label: 'DEA telehealth controlled substances',
    detail: 'Federal telehealth CS prescribing rules',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'md_minor_consent',
    label: 'Maryland minor consent',
    detail: 'HG §20-104 / §20-102(c)',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'prp_comar',
    label: 'PRP COMAR',
    detail: 'COMAR 10.63 / 10.09.59',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'tp_review',
    label: 'Treatment plan review',
    detail: 'Adults ≤180 days from Practice Settings; under 18 ≤90',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'spravato_rems',
    label: 'Spravato REMS',
    detail: 'REMS enrollment and monitoring',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'telehealth_consent',
    label: 'Telehealth consent / location',
    detail: 'Audio-only only with patient agreement + payer modifiers 93/FQ',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'discharge_aftercare',
    label: 'Discharge aftercare',
    detail: 'Aftercare plan on discharge',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'sdoh_yearly',
    label: 'SDOH yearly (AHC-HRSN)',
    detail: 'Annual social needs screen',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'tms_course_pa',
    label: 'TMS course + PA',
    detail: 'Course documentation and prior auth',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'duty_to_warn',
    label: 'Duty to warn',
    detail: 'Cts. & Jud. Proc. §5-609',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'child_abuse',
    label: 'Child abuse report',
    detail: 'Family Law §5-704',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'vulnerable_adult',
    label: 'Vulnerable adult',
    detail: 'Family Law §14-302',
    status: 'confirmed',
    badge: CONFIRMED_BY_PRACTICE_BADGE,
  },
  {
    id: 'uspstf',
    label: 'USPSTF screening',
    detail: 'Do not invent confirmation',
    status: 'confirm_with_compliance',
    badge: CONFIRM_WITH_COMPLIANCE_BADGE,
  },
  {
    id: 'acip',
    label: 'ACIP immunization',
    detail: 'Do not invent confirmation',
    status: 'confirm_with_compliance',
    badge: CONFIRM_WITH_COMPLIANCE_BADGE,
  },
  {
    id: 'collaborative_care',
    label: 'Collaborative care',
    detail: 'Do not invent confirmation',
    status: 'confirm_with_compliance',
    badge: CONFIRM_WITH_COMPLIANCE_BADGE,
  },
  {
    id: 'initial_tp_deadline',
    label: 'Initial treatment plan deadline after intake',
    detail: 'Open numeric — unenforced until practice supplies number',
    status: 'open_numeric',
  },
  {
    id: 'discharge_summary_deadline',
    label: 'Discharge summary deadline',
    detail: 'Open numeric — unenforced until practice supplies number',
    status: 'open_numeric',
  },
];

const BH_CORE: GuideStepDef[] = [
  {
    key: 'cssrs',
    label: 'C-SSRS (suicide screen)',
    phase: 'prepare',
    level: 'required',
    action: 'assessment',
    instrumentName: 'C-SSRS',
    href: '/dashboard/ehr/assessments',
  },
  {
    key: 'consents',
    label: 'Consents current',
    phase: 'prepare',
    level: 'required',
    action: 'consents',
    href: '/dashboard/ehr/consents',
  },
  {
    key: 'treatment_plan',
    label: 'Treatment plan current',
    phase: 'prepare',
    level: 'required',
    action: 'treatment_plan',
    href: '/dashboard/ehr/treatment-plans',
  },
  {
    key: 'chief_concern',
    label: 'Chief concern / presenting problem',
    phase: 'during',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'interventions',
    label: 'Interventions used',
    phase: 'during',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'client_response',
    label: 'Client response',
    phase: 'during',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'risk_check',
    label: 'Risk / safety check',
    phase: 'during',
    level: 'required',
    action: 'safety_plan',
    href: '/dashboard/ehr/safety-plans',
  },
  {
    key: 'plan_next',
    label: 'Plan and next visit',
    phase: 'wrap_up',
    level: 'required',
    action: 'book_followup',
    href: '/dashboard/appointments',
  },
  {
    key: 'sdoh',
    label: 'SDOH (AHC-HRSN) if due',
    phase: 'prepare',
    level: 'recommended',
    action: 'sdoh',
    when: 'always',
  },
];

const PRESCRIBER_CORE: GuideStepDef[] = [
  {
    key: 'cssrs',
    label: 'C-SSRS (suicide screen)',
    phase: 'prepare',
    level: 'required',
    action: 'assessment',
    instrumentName: 'C-SSRS',
    href: '/dashboard/ehr/assessments',
  },
  {
    key: 'med_review',
    label: 'Current medications review',
    phase: 'prepare',
    level: 'required',
    action: 'drfirst_medications',
  },
  {
    key: 'allergy_review',
    label: 'Allergy review',
    phase: 'prepare',
    level: 'required',
    action: 'drfirst_allergies',
  },
  {
    key: 'pdmp',
    label: 'PDMP attest (opioid/benzo)',
    phase: 'during',
    level: 'required',
    action: 'pdmp_attest',
    when: 'opioid_benzo',
    href: '/dashboard/ehr/hie',
  },
  {
    key: 'aims',
    label: 'AIMS (movement exam)',
    phase: 'during',
    level: 'required',
    action: 'assessment',
    when: 'antipsychotic',
    instrumentName: 'AIMS',
    href: '/dashboard/ehr/assessments',
  },
  {
    key: 'side_effects',
    label: 'Side effects review',
    phase: 'during',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'mse',
    label: 'Mental status exam',
    phase: 'during',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'risk_check',
    label: 'Risk / safety check',
    phase: 'during',
    level: 'required',
    action: 'safety_plan',
    href: '/dashboard/ehr/safety-plans',
  },
  {
    key: 'rx_decision',
    label: 'Prescription decision (DrFirst)',
    phase: 'wrap_up',
    level: 'required',
    action: 'drfirst_patient',
    href: '/dashboard/ehr/prescriptions',
  },
  {
    key: 'plan_next',
    label: 'Plan and next visit',
    phase: 'wrap_up',
    level: 'required',
    action: 'book_followup',
    href: '/dashboard/appointments',
  },
];

const PRIMARY_CARE_STEPS: GuideStepDef[] = [
  {
    key: 'identity',
    label: 'Identity confirmation',
    phase: 'prepare',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'vitals',
    label: 'Vitals captured',
    phase: 'prepare',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'chief_complaint',
    label: 'Chief complaint',
    phase: 'prepare',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'allergy_med_review',
    label: 'Allergy + medication review',
    phase: 'prepare',
    level: 'required',
    action: 'drfirst_medications',
  },
  {
    key: 'screenings',
    label: 'Screenings due (PHQ-2→9, tobacco, AUDIT-C, falls, SDOH)',
    phase: 'prepare',
    level: 'recommended',
    action: 'assessment',
    href: '/dashboard/ehr/assessments',
  },
  {
    key: 'care_gaps',
    label: 'Care gaps review',
    phase: 'during',
    level: 'required',
    action: 'link',
    href: '/dashboard/medical',
  },
  {
    key: 'exam_ap',
    label: 'Exam + assessment & plan',
    phase: 'during',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'em_code',
    label: 'E/M code selection',
    phase: 'wrap_up',
    level: 'required',
    action: 'note_section',
  },
  {
    key: 'followup',
    label: 'Book follow-up',
    phase: 'wrap_up',
    level: 'recommended',
    action: 'book_followup',
    href: '/dashboard/appointments',
  },
];

const KIND_EXTRA: Partial<Record<VisitKindId, GuideStepDef[]>> = {
  therapy_intake: [
    {
      key: 'history',
      label: 'History / biopsychosocial',
      phase: 'during',
      level: 'required',
      action: 'note_section',
    },
    {
      key: 'dx',
      label: 'Working diagnosis',
      phase: 'wrap_up',
      level: 'required',
      action: 'note_section',
    },
  ],
  psych_eval_adult: [
    {
      key: 'history',
      label: 'History',
      phase: 'during',
      level: 'required',
      action: 'note_section',
    },
    {
      key: 'dx',
      label: 'Diagnosis',
      phase: 'wrap_up',
      level: 'required',
      action: 'note_section',
    },
    {
      key: 'initial_plan',
      label: 'Initial plan',
      phase: 'wrap_up',
      level: 'required',
      action: 'treatment_plan',
      href: '/dashboard/ehr/treatment-plans',
    },
  ],
  psych_eval_child: [
    {
      key: 'history',
      label: 'Developmental / family history',
      phase: 'during',
      level: 'required',
      action: 'note_section',
    },
    {
      key: 'minor_consent',
      label: 'Minor consent documentation',
      phase: 'prepare',
      level: 'required',
      action: 'consents',
      when: 'minor',
      href: '/dashboard/ehr/consents',
    },
  ],
  sud_individual: [
    {
      key: 'part2_roi',
      label: 'Part 2 ROI on file',
      phase: 'prepare',
      level: 'required',
      action: 'consents',
      part2: true,
      href: '/dashboard/ehr/consents',
    },
  ],
  sud_group: [
    {
      key: 'part2_roi',
      label: 'Part 2 ROI on file',
      phase: 'prepare',
      level: 'required',
      action: 'consents',
      part2: true,
      href: '/dashboard/ehr/consents',
    },
  ],
  sud_intake: [
    {
      key: 'part2_roi',
      label: 'Part 2 ROI on file',
      phase: 'prepare',
      level: 'required',
      action: 'consents',
      part2: true,
      href: '/dashboard/ehr/consents',
    },
  ],
  iop: [
    {
      key: 'weekly_hours',
      label: 'Weekly hours toward minimum',
      phase: 'wrap_up',
      level: 'required',
      action: 'link',
      href: '/dashboard/programs/intensive',
    },
  ],
  php: [
    {
      key: 'weekly_hours',
      label: 'Weekly hours toward minimum',
      phase: 'wrap_up',
      level: 'required',
      action: 'link',
      href: '/dashboard/programs/intensive',
    },
  ],
  prp: [
    {
      key: 'irp_goal',
      label: 'IRP goal + intervention + response',
      phase: 'during',
      level: 'required',
      action: 'note_section',
    },
  ],
  spravato: [
    {
      key: 'rems',
      label: 'Spravato REMS checklist',
      phase: 'prepare',
      level: 'required',
      action: 'link',
    },
  ],
  tms: [
    {
      key: 'tms_pa',
      label: 'TMS course + prior auth',
      phase: 'prepare',
      level: 'required',
      action: 'link',
    },
  ],
  discharge: [
    {
      key: 'aftercare',
      label: 'Discharge aftercare plan',
      phase: 'wrap_up',
      level: 'required',
      action: 'note_section',
    },
  ],
  telephone: [
    {
      key: 'audio_only',
      label: 'Audio-only agreement + modifiers 93/FQ',
      phase: 'prepare',
      level: 'required',
      action: 'consents',
      when: 'telehealth',
    },
  ],
  no_show: [
    {
      key: 'outreach',
      label: 'Outreach logged',
      phase: 'wrap_up',
      level: 'required',
      action: 'note_section',
    },
  ],
};

function baseStepsForKind(kind: VisitKindId): GuideStepDef[] {
  if (kind === 'primary_care') return PRIMARY_CARE_STEPS;
  const def = VISIT_KINDS[kind];
  if (def.audience === 'prescriber') return PRESCRIBER_CORE;
  if (kind === 'no_show' || kind === 'discharge' || kind === 'other') {
    return KIND_EXTRA[kind] || [
      {
        key: 'document',
        label: 'Document encounter outcome',
        phase: 'wrap_up',
        level: 'required',
        action: 'note_section',
      },
    ];
  }
  return BH_CORE;
}

export function stepsForVisitKind(kind: VisitKindId): GuideStepDef[] {
  const base = baseStepsForKind(kind);
  const extra = KIND_EXTRA[kind] || [];
  const seen = new Set<string>();
  const merged: GuideStepDef[] = [];
  for (const step of [...extra.filter((s) => s.phase === 'prepare'), ...base, ...extra.filter((s) => s.phase !== 'prepare')]) {
    if (seen.has(step.key)) continue;
    seen.add(step.key);
    merged.push(step);
  }
  return merged;
}

export function briefForVisitKind(kind: VisitKindId): { title: string; summary: string; cpt: string[] } {
  const def = VISIT_KINDS[kind];
  return {
    title: def.label,
    summary:
      def.audience === 'prescriber'
        ? 'Prescriber visit — meds, risk, and documentation checklist. Signing is not hard-blocked by incomplete recommended steps.'
        : def.audience === 'program'
          ? 'Program encounter — complete IRP-linked documentation. PRP codes appear only after billing model confirmation.'
          : 'Bedside checklist for this visit type. Required steps warn at sign time; they do not hard-block signing.',
    cpt: def.defaultCpt,
  };
}

export const GUIDE_PHASE_LABELS: Record<GuidePhase, string> = {
  prepare: 'Prepare',
  during: 'During',
  wrap_up: 'Wrap-up',
};

export const GUIDE_LEVEL_LABELS: Record<GuideLevel, string> = {
  required: 'required',
  recommended: 'recommended',
  optional: 'optional',
};

export const GUIDE_TAB_LABELS: Record<GuideTab, string> = {
  brief: 'Brief',
  checklist: 'Checklist',
  due: 'Due',
  requirements: 'Requirements',
};
