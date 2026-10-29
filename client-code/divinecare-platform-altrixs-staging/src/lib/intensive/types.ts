/**
 * Intensive programs (IOP / PHP): shared constants and types. Pure and browser-safe.
 *
 * Program types:
 *  - MH_IOP   mental health intensive outpatient (per diem default S9480)
 *  - SUD_IOP  substance use intensive outpatient, ASAM level 2.1 (per diem default H0015);
 *             every SUD IOP record is 42 CFR Part 2
 *  - PHP      partial hospitalization, ASAM 2.5 / mental health PHP (per diem default H0035);
 *             off until the practice confirms it holds PHP licensure
 *
 * Every code here is a default for billing to confirm (no fees are stored anywhere in the module).
 */

export const PROGRAM_TYPES = ['MH_IOP', 'SUD_IOP', 'PHP'] as const;
export type ProgramType = (typeof PROGRAM_TYPES)[number];

export function isProgramType(v: unknown): v is ProgramType {
  return typeof v === 'string' && (PROGRAM_TYPES as readonly string[]).includes(v);
}

export type ProgramTypeMeta = {
  label: string;
  shortLabel: string;
  /** Level of care this program is */
  level: 'IOP' | 'PHP';
  asamLevel: string | null;
  /** HCPCS per diem default (billing confirms) */
  defaultPerDiemCode: string;
  /** Visit Guide kind for a program session (src/lib/visits/protocols.ts) */
  visitKind: 'iop' | 'php';
  /** Always 42 CFR Part 2 (SUD IOP). A PHP is Part 2 when set up as a SUD (ASAM 2.5) program. */
  alwaysPart2: boolean;
  requiresLicensure: boolean;
  note: string;
};

export const PROGRAM_TYPE_META: Record<ProgramType, ProgramTypeMeta> = {
  MH_IOP: {
    label: 'Mental health IOP',
    shortLabel: 'MH IOP',
    level: 'IOP',
    asamLevel: null,
    defaultPerDiemCode: 'S9480',
    visitKind: 'iop',
    alwaysPart2: false,
    requiresLicensure: false,
    note: 'Intensive outpatient psychiatric services; S9480 per diem default (confirm with billing / payer).',
  },
  SUD_IOP: {
    label: 'SUD IOP (ASAM 2.1)',
    shortLabel: 'SUD IOP',
    level: 'IOP',
    asamLevel: '2.1',
    defaultPerDiemCode: 'H0015',
    visitKind: 'iop',
    alwaysPart2: true,
    requiresLicensure: false,
    note: 'Substance use intensive outpatient, ASAM 2.1; H0015 default (confirm with billing / payer). 42 CFR Part 2 records.',
  },
  PHP: {
    label: 'Partial hospitalization (ASAM 2.5 / MH PHP)',
    shortLabel: 'PHP',
    level: 'PHP',
    asamLevel: '2.5',
    defaultPerDiemCode: 'H0035',
    visitKind: 'php',
    alwaysPart2: false,
    requiresLicensure: true,
    note: 'Requires PHP licensure. Disabled until the practice confirms its PHP license. H0035 default (confirm with billing / payer).',
  },
};

export const AGE_GROUPS = ['adult', 'adolescent'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
export const AGE_GROUP_LABEL: Record<AgeGroup, string> = { adult: 'Adult', adolescent: 'Adolescent' };

export const SESSION_TYPES = ['group', 'individual', 'family', 'psychiatry'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
export const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  group: 'Group',
  individual: 'Individual',
  family: 'Family',
  psychiatry: 'Psychiatry',
};

/** Same statuses as the group-sessions module (src/lib/groups/types.ts). */
export const ATTENDANCE_STATUSES = ['present', 'late', 'left_early', 'absent', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  left_early: 'Left early',
  absent: 'Absent',
  excused: 'Excused',
};
export function isAttendedStatus(s: string | null | undefined): boolean {
  return s === 'present' || s === 'late' || s === 'left_early';
}

export const ENROLLMENT_STATUSES = ['referred', 'screening', 'admitted', 'discharged', 'declined'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  referred: 'Referred',
  screening: 'Screening',
  admitted: 'Admitted',
  discharged: 'Discharged',
  declined: 'Not admitted',
};

/** Levels a client can move to at discharge. */
export const CARE_LEVELS = ['OP', 'IOP', 'PHP', 'residential', 'inpatient', 'other_provider', 'none'] as const;
export type CareLevel = (typeof CARE_LEVELS)[number];
export const CARE_LEVEL_LABEL: Record<CareLevel, string> = {
  OP: 'Outpatient (OP)',
  IOP: 'Intensive outpatient (IOP)',
  PHP: 'Partial hospitalization (PHP)',
  residential: 'Residential',
  inpatient: 'Inpatient',
  other_provider: 'Other provider (transfer)',
  none: 'No further services',
};

export const DISCHARGE_REASONS = [
  'completed',
  'step_down',
  'step_up',
  'client_choice',
  'non_attendance',
  'transferred',
  'authorization_ended',
  'administrative',
  'other',
] as const;
export type DischargeReason = (typeof DISCHARGE_REASONS)[number];
export const DISCHARGE_REASON_LABEL: Record<DischargeReason, string> = {
  completed: 'Completed program (goals met)',
  step_down: 'Stepped down to a lower level of care',
  step_up: 'Needs a higher level of care',
  client_choice: 'Client chose to leave (against advice)',
  non_attendance: 'Non-attendance / lost to contact',
  transferred: 'Transferred to another provider',
  authorization_ended: 'Authorization / coverage ended',
  administrative: 'Administrative discharge',
  other: 'Other',
};

export type ScheduleBlock = { key: string; label: string; start: string; minutes: number; sessionType: SessionType };
export type ScheduleTemplate = { days: number[]; blocks: ScheduleBlock[] };

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const BILLING_MODES = ['per_diem', 'per_service'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const UNIT_TYPES = ['per_diem', 'per_session', 'per_15_min', 'per_hour'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];
export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  per_diem: 'Per diem (1 unit per day)',
  per_session: 'Per session',
  per_15_min: 'Per 15 minutes',
  per_hour: 'Per hour',
};
export type UnitRounding = 'midpoint' | 'whole';
export type UnitRule = { code: string; unit: UnitType; minMinutes: number | null; rounding: UnitRounding };

export type ServiceCodes = Record<SessionType, string | null>;

/** Admission criteria checklist (practice checklist; the clinician's level-of-care decision decides). */
export type CriterionDef = { key: string; label: string; only?: ProgramType[] };
export const ADMISSION_CRITERIA: CriterionDef[] = [
  { key: 'dx_documented', label: 'Behavioral health diagnosis documented' },
  { key: 'loc_supports', label: 'Level-of-care assessment (LOCUS / CALOCUS / ASAM) supports this level' },
  { key: 'needs_structure', label: 'Needs more structure than weekly outpatient care' },
  { key: 'php_daily_need', label: 'Needs daily structured treatment (step-down from or to avoid inpatient)', only: ['PHP'] },
  { key: 'withdrawal_managed', label: 'No withdrawal risk needing a higher level (ASAM dimension 1)', only: ['SUD_IOP', 'PHP'] },
  { key: 'medically_stable', label: 'Medically stable; does not need 24-hour care' },
  { key: 'safe_outside_hours', label: 'Can be safe outside program hours (safety plan in place when indicated)' },
  { key: 'able_to_participate', label: 'Able and willing to attend the program schedule' },
];

export function criteriaFor(type: ProgramType): CriterionDef[] {
  return ADMISSION_CRITERIA.filter((c) => !c.only || c.only.includes(type));
}

/** Consent-library keys (src/lib/consents/library) checked before admission. */
export const CONSENT_KEYS = {
  treatment: 'informed-consent-treatment',
  part2: 'part2-consent',
  group: 'group-therapy-confidentiality',
  minor: 'minor-consent-treatment',
} as const;

export const OUTREACH_METHODS = ['phone', 'text', 'portal_message', 'email', 'letter', 'in_person', 'emergency_contact'] as const;
export type OutreachMethod = (typeof OUTREACH_METHODS)[number];
export const OUTREACH_METHOD_LABEL: Record<OutreachMethod, string> = {
  phone: 'Phone call',
  text: 'Text message',
  portal_message: 'Portal message',
  email: 'Email',
  letter: 'Letter',
  in_person: 'In person',
  emergency_contact: 'Emergency contact',
};
export type OutreachAttempt = { at: string; byId: string; byName: string | null; method: OutreachMethod; outcome: string; note: string | null };

export const HOLD_REASON_LABEL: Record<string, string> = {
  no_auth: 'No authorization linked',
  auth_out_of_dates: 'Date of service outside the authorization dates',
  auth_exhausted: 'Authorization units used up',
  per_diem_minimum_not_set: 'Minimum minutes for a billable day not set (billing to confirm)',
  below_minimum_minutes: 'Below the minimum minutes set for this code',
  code_not_set: 'No billing code set for this service',
  php_psych_eval_missing: 'PHP psychiatric evaluation not documented',
  note_missing: 'No progress note linked to this service',
  policy_unconfirmed: 'Program billing policy not yet confirmed by the practice',
};
