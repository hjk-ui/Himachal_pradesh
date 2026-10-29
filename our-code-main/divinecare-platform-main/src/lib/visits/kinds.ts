/**
 * Visit Guide visit kinds — Oct 21 2026 staging parity.
 * Labels, audiences, and default CPT lists must stay same-to-same.
 */

export type VisitAudience = 'therapist' | 'prescriber' | 'program' | 'mixed';

export type VisitKindId =
  | 'therapy_intake'
  | 'psych_eval_adult'
  | 'psych_eval_child'
  | 'psych_reeval'
  | 'med_management'
  | 'therapy_individual'
  | 'therapy_family'
  | 'group_therapy'
  | 'sud_individual'
  | 'sud_group'
  | 'sud_intake'
  | 'prp'
  | 'iop'
  | 'php'
  | 'crisis_followup'
  | 'telephone'
  | 'primary_care'
  | 'tms'
  | 'spravato'
  | 'treatment_plan_review'
  | 'discharge'
  | 'no_show'
  | 'other';

export type VisitKindDef = {
  id: VisitKindId;
  label: string;
  audience: VisitAudience;
  /** Default CPT / HCPCS offered in Visit Guide (not auto-billed). */
  defaultCpt: string[];
  /** Part 2 / SUD-sensitive visit */
  part2?: boolean;
};

export const VISIT_KINDS: Record<VisitKindId, VisitKindDef> = {
  therapy_intake: {
    id: 'therapy_intake',
    label: 'Therapy intake',
    audience: 'therapist',
    defaultCpt: ['90791'],
  },
  psych_eval_adult: {
    id: 'psych_eval_adult',
    label: 'Psychiatric evaluation (adult)',
    audience: 'prescriber',
    defaultCpt: ['90792', '99205', '99204'],
  },
  psych_eval_child: {
    id: 'psych_eval_child',
    label: 'Psychiatric evaluation (child)',
    audience: 'prescriber',
    defaultCpt: ['90792', '99205', '99204'],
  },
  psych_reeval: {
    id: 'psych_reeval',
    label: 'Psychiatric re-evaluation',
    audience: 'prescriber',
    defaultCpt: ['99214', '99215', '90792'],
  },
  med_management: {
    id: 'med_management',
    label: 'Medication management',
    audience: 'prescriber',
    defaultCpt: ['99214', '99213', '99215', '99212', '90833', '90836', '90838'],
  },
  therapy_individual: {
    id: 'therapy_individual',
    label: 'Individual therapy',
    audience: 'therapist',
    defaultCpt: ['90837', '90834', '90832'],
  },
  therapy_family: {
    id: 'therapy_family',
    label: 'Family therapy',
    audience: 'therapist',
    defaultCpt: ['90847', '90846'],
  },
  group_therapy: {
    id: 'group_therapy',
    label: 'Group therapy',
    audience: 'therapist',
    defaultCpt: ['90853'],
  },
  sud_individual: {
    id: 'sud_individual',
    label: 'SUD counseling',
    audience: 'therapist',
    defaultCpt: ['H0004'],
    part2: true,
  },
  sud_group: {
    id: 'sud_group',
    label: 'SUD group',
    audience: 'therapist',
    defaultCpt: ['H0005'],
    part2: true,
  },
  sud_intake: {
    id: 'sud_intake',
    label: 'SUD intake',
    audience: 'therapist',
    defaultCpt: ['H0001', '90791'],
    part2: true,
  },
  prp: {
    id: 'prp',
    label: 'PRP service',
    audience: 'program',
    /** Codes only after practice confirms PRP billing model */
    defaultCpt: [],
  },
  iop: {
    id: 'iop',
    label: 'Intensive outpatient (IOP)',
    audience: 'therapist',
    defaultCpt: ['S9480', 'H0015'],
  },
  php: {
    id: 'php',
    label: 'Partial hospitalization (PHP)',
    audience: 'therapist',
    defaultCpt: ['H0035'],
  },
  crisis_followup: {
    id: 'crisis_followup',
    label: 'Crisis follow-up',
    audience: 'mixed',
    defaultCpt: ['90839', '90840'],
  },
  telephone: {
    id: 'telephone',
    label: 'Telephone visit',
    audience: 'mixed',
    defaultCpt: ['99441', '99442', '99443'],
  },
  primary_care: {
    id: 'primary_care',
    label: 'Primary care',
    audience: 'mixed',
    defaultCpt: ['99212', '99213', '99214', '99215'],
  },
  tms: {
    id: 'tms',
    label: 'TMS',
    audience: 'prescriber',
    defaultCpt: ['90867', '90868', '90869'],
  },
  spravato: {
    id: 'spravato',
    label: 'Spravato',
    audience: 'prescriber',
    defaultCpt: ['G2082', 'G2083'],
  },
  treatment_plan_review: {
    id: 'treatment_plan_review',
    label: 'Treatment plan review',
    audience: 'mixed',
    defaultCpt: ['90837', '99214'],
  },
  discharge: {
    id: 'discharge',
    label: 'Discharge',
    audience: 'mixed',
    defaultCpt: [],
  },
  no_show: {
    id: 'no_show',
    label: 'No-show',
    audience: 'mixed',
    defaultCpt: [],
  },
  other: {
    id: 'other',
    label: 'Other',
    audience: 'mixed',
    defaultCpt: [],
  },
};

export const VISIT_KIND_LIST = Object.values(VISIT_KINDS);

/** Map legacy UI labels / appointment type strings → VisitKindId */
const LABEL_ALIASES: Array<{ match: RegExp; kind: VisitKindId }> = [
  { match: /^therapy\s*intake|^initial\s*intake|^intake$/i, kind: 'therapy_intake' },
  { match: /psych(iatric)?\s*eval.*child|child.*psych/i, kind: 'psych_eval_child' },
  { match: /psych(iatric)?\s*re-?eval/i, kind: 'psych_reeval' },
  { match: /^psych\s*eval$|psych(iatric)?\s*eval|psychiatric evaluation/i, kind: 'psych_eval_adult' },
  { match: /^med\s*mgmt$|med(ication)?\s*(mgmt|management|review)/i, kind: 'med_management' },
  { match: /^mft$|family\s*therapy|marriage/i, kind: 'therapy_family' },
  { match: /^group$|group\s*therapy/i, kind: 'group_therapy' },
  { match: /sud\s*intake|substance.*intake/i, kind: 'sud_intake' },
  { match: /sud\s*group|substance.*group/i, kind: 'sud_group' },
  { match: /^sud$|sud\b|substance\s*use|H0004/i, kind: 'sud_individual' },
  { match: /\bprp\b/i, kind: 'prp' },
  { match: /\biop\b|intensive\s*outpatient/i, kind: 'iop' },
  { match: /\bphp\b|partial\s*hospital/i, kind: 'php' },
  { match: /crisis/i, kind: 'crisis_followup' },
  { match: /telephone|phone\s*visit|audio.?only/i, kind: 'telephone' },
  { match: /primary\s*care|annual\s*physical|htn|diabetes|acute\s*visit|well-?woman/i, kind: 'primary_care' },
  { match: /\btms\b/i, kind: 'tms' },
  { match: /spravato|esketamine/i, kind: 'spravato' },
  { match: /treatment\s*plan/i, kind: 'treatment_plan_review' },
  { match: /discharge/i, kind: 'discharge' },
  { match: /no.?show/i, kind: 'no_show' },
  { match: /individual\s*therapy|telehealth\s*session|^soap$|^dap$|^birp$|^girp$|^pie$|^cbt$|^dbt$|^emdr$/i, kind: 'therapy_individual' },
];

export function resolveVisitKind(input: string | null | undefined): VisitKindId {
  const raw = (input || '').trim();
  if (!raw) return 'other';
  if (raw in VISIT_KINDS) return raw as VisitKindId;
  for (const { match, kind } of LABEL_ALIASES) {
    if (match.test(raw)) return kind;
  }
  return 'other';
}
