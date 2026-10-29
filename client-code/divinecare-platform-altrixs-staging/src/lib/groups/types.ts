/**
 * Group therapy (psychotherapy) and SUD group counseling: shared types, defaults and note
 * templates. Pure and browser-safe (no Prisma, no React).
 *
 * The two kinds are SEPARATE areas (clinical director, Oct 19 2026): their own page, list,
 * "Today's groups", create defaults and note template. A group's kind never changes once it has
 * notes. Every SUD group, its attendance and its notes are 42 CFR Part 2.
 *
 * Billing defaults are defaults only: the code is configurable per group, and every default is
 * listed for billing to confirm. PRP groups are attendance only (PRP bills H2016 / H2018 from the
 * PRP hub); IOP groups roll into the IOP per diem (attendance only, no per-session line).
 */

export const GROUP_KINDS = ['psychotherapy', 'sud'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export function isGroupKind(v: unknown): v is GroupKind {
  return v === 'psychotherapy' || v === 'sud';
}

export type GroupKindMeta = {
  label: string;
  shortLabel: string;
  href: string;
  /** ProgressNote.noteType of each attendee's note */
  noteType: string;
  /** How the facilitator signs on this kind of note (practice naming) */
  signerTitle: string;
  /** Appointment.type of the per-member visit. Neutral wording: it shows on calendars. */
  appointmentType: string;
  description: string;
};

export const GROUP_KIND_META: Record<GroupKind, GroupKindMeta> = {
  psychotherapy: {
    label: 'Group Therapy (Psychotherapy)',
    shortLabel: 'Group therapy',
    href: '/dashboard/ehr/group-sessions',
    noteType: 'Group Therapy Note',
    signerTitle: 'Group therapist',
    appointmentType: 'Group Therapy',
    description: 'Psychotherapy, skills and psychoeducation groups (OMHC). Default code CPT 90853.',
  },
  sud: {
    label: 'SUD Group Counseling',
    shortLabel: 'SUD group',
    href: '/dashboard/ehr/sud-groups',
    noteType: 'SUD Group Counseling Note',
    signerTitle: 'SUD counselor',
    // Neutral on purpose: calendars and reminders must not disclose substance use treatment
    appointmentType: 'Group Counseling',
    description: 'Substance use group counseling and IOP groups. 42 CFR Part 2 records. Default code HCPCS H0005.',
  },
};

export type Option = { value: string; label: string };

export const GROUP_TYPES: Record<GroupKind, Option[]> = {
  psychotherapy: [
    { value: 'therapy', label: 'Group psychotherapy' },
    { value: 'skills', label: 'Skills group (e.g. DBT skills)' },
    { value: 'psychoeducation', label: 'Psychoeducation' },
    { value: 'prp', label: 'PRP group (attendance only)' },
    { value: 'other', label: 'Other' },
  ],
  sud: [
    { value: 'sud_counseling', label: 'SUD group counseling' },
    { value: 'sud_iop', label: 'IOP group (per diem)' },
    { value: 'psychoeducation', label: 'SUD psychoeducation' },
    { value: 'other', label: 'Other' },
  ],
};

export function groupTypeLabel(kind: GroupKind, type: string): string {
  return GROUP_TYPES[kind].find((t) => t.value === type)?.label ?? type;
}

export const BILLING_MODES = ['per_session', 'attendance_only'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export type BillingDefault = {
  billingCode: string | null;
  billingMode: BillingMode;
  /** Shown next to the code; every default is "confirm with billing" */
  note: string;
  /** PRP: the code cannot be set here (PRP bills from the PRP hub) */
  locked?: boolean;
};

export const PRP_HUB_HREF = '/dashboard/prp';

/** Default code / mode for a new group. Never a payer rule: billing confirms or changes it. */
export function defaultBilling(kind: GroupKind, groupType: string): BillingDefault {
  if (kind === 'psychotherapy') {
    if (groupType === 'therapy' || groupType === 'skills') {
      return { billingCode: '90853', billingMode: 'per_session', note: 'CPT 90853 group psychotherapy (default, confirm with billing).' };
    }
    if (groupType === 'prp') {
      return {
        billingCode: null,
        billingMode: 'attendance_only',
        locked: true,
        note: 'PRP groups record attendance and group notes only. PRP services are billed from the PRP hub (H2016 / H2018 rules); no claim line is made here.',
      };
    }
    return {
      billingCode: null,
      billingMode: 'attendance_only',
      note: 'No default code: psychoeducation is not group psychotherapy (90853). Set a code only when billing confirms one.',
    };
  }
  if (groupType === 'sud_counseling') {
    return { billingCode: 'H0005', billingMode: 'per_session', note: 'HCPCS H0005 alcohol and/or drug services, group counseling by a clinician (default, confirm with billing).' };
  }
  if (groupType === 'sud_iop') {
    return {
      billingCode: null,
      billingMode: 'attendance_only',
      note: 'IOP groups roll into the IOP per diem (H0015): attendance only, no per-session claim line. Switch to per session only if billing says so.',
    };
  }
  return {
    billingCode: null,
    billingMode: 'attendance_only',
    note: 'No default code for this group type. Set one only when billing confirms it.',
  };
}

export const GROUP_STATUSES = ['active', 'paused', 'archived'] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

export const ENROLLMENT_TYPES = ['open', 'closed'] as const;
export type EnrollmentType = (typeof ENROLLMENT_TYPES)[number];

export const MEMBER_STATUSES = ['active', 'completed', 'discharged', 'withdrawn', 'inactive'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MEMBER_LEAVE_REASONS: Option[] = [
  { value: 'completed', label: 'Completed the group' },
  { value: 'discharged', label: 'Discharged from services' },
  { value: 'withdrawn', label: 'Client withdrew' },
  { value: 'level_of_care', label: 'Changed level of care' },
  { value: 'attendance', label: 'Attendance policy' },
  { value: 'other', label: 'Other' },
];

export const SESSION_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['present', 'late', 'left_early', 'absent', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number] | 'unmarked';

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  left_early: 'Left early',
  absent: 'Absent',
  excused: 'Excused',
  unmarked: 'Not marked',
};

export function isAttendanceStatus(v: unknown): v is AttendanceStatus {
  return v === 'unmarked' || (ATTENDANCE_STATUSES as readonly unknown[]).includes(v);
}

/** Present, late and left early count as attended (a note is written; billing checks minutes). */
export function isAttended(status: string | null | undefined): boolean {
  return status === 'present' || status === 'late' || status === 'left_early';
}

/** 42 CFR Part 2 notice for outputs (short form, 42 CFR 2.32(a)(2)); same text as treatment plan documents. */
export const PART2_REDISCLOSURE_NOTICE = '42 CFR part 2 prohibits unauthorized use or disclosure of these records.';

// ─── Note templates ──────────────────────────────────────────────────────────

export type NoteFieldKind = 'text' | 'textarea' | 'select' | 'number' | 'goals' | 'multiselect';

export type NoteField = {
  key: string;
  label: string;
  kind: NoteFieldKind;
  required?: boolean;
  options?: Option[];
  min?: number;
  max?: number;
  help?: string;
  placeholder?: string;
};

const RISK_OPTIONS: Option[] = [
  { value: 'none', label: 'No risk indicators observed or reported' },
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High (safety plan / crisis protocol)' },
];

const PARTICIPATION_OPTIONS: Option[] = [
  { value: 'active', label: 'Active, engaged' },
  { value: 'moderate', label: 'Participated when prompted' },
  { value: 'minimal', label: 'Minimal participation' },
  { value: 'disruptive', label: 'Disruptive / redirected' },
  { value: 'observed', label: 'Attended, did not participate' },
];

export const SUD_CURRICULUM: Option[] = [
  { value: 'relapse_prevention', label: 'Relapse prevention' },
  { value: 'coping_skills', label: 'Coping skills' },
  { value: 'mi', label: 'Motivational interviewing (MI)' },
  { value: 'cbt_sud', label: 'CBT for substance use' },
  { value: 'psychoeducation', label: 'Psychoeducation' },
  { value: 'other', label: 'Other' },
];

export const STAGES_OF_CHANGE: Option[] = [
  { value: 'precontemplation', label: 'Precontemplation' },
  { value: 'contemplation', label: 'Contemplation' },
  { value: 'preparation', label: 'Preparation' },
  { value: 'action', label: 'Action' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'recurrence', label: 'Recurrence (return to use)' },
];

export const ASAM_DIMENSIONS: Option[] = [
  { value: 'd1', label: 'D1 Intoxication / withdrawal' },
  { value: 'd2', label: 'D2 Biomedical' },
  { value: 'd3', label: 'D3 Emotional / behavioral / cognitive' },
  { value: 'd4', label: 'D4 Readiness to change' },
  { value: 'd5', label: 'D5 Relapse / continued use potential' },
  { value: 'd6', label: 'D6 Recovery environment' },
];

export const USE_SINCE_LAST: Option[] = [
  { value: 'none_reported', label: 'No use reported' },
  { value: 'use_reported', label: 'Use reported' },
  { value: 'declined', label: 'Declined to answer' },
  { value: 'not_asked', label: 'Not asked this session' },
];

/** UDS / toxicology source: lab = read from the Labs module; self / staff = entered here. */
export const UDS_SOURCES: Option[] = [
  { value: 'none', label: 'Not collected' },
  { value: 'lab', label: 'Lab result (Labs module)' },
  { value: 'staff', label: 'Point-of-care, staff-entered' },
  { value: 'self', label: 'Self-reported' },
];

/** Shared group section: written once per session, copied into every attendee's note. Never names members. */
export const SHARED_FIELDS: Record<GroupKind, NoteField[]> = {
  psychotherapy: [
    { key: 'topic', label: 'Session topic / theme', kind: 'text', required: true },
    { key: 'objectives', label: 'Session objectives', kind: 'textarea' },
    { key: 'interventions', label: 'Interventions used', kind: 'textarea', required: true, placeholder: 'e.g. CBT cognitive restructuring, DBT distress tolerance skills, process group' },
    { key: 'dynamics', label: 'Group process and dynamics', kind: 'textarea', help: 'Describe the group as a whole. Do not name or describe individual members here.' },
    { key: 'plan', label: 'Plan for next session', kind: 'textarea' },
  ],
  sud: [
    { key: 'curriculum', label: 'Topic / curriculum', kind: 'select', required: true, options: SUD_CURRICULUM },
    { key: 'topic', label: 'Session topic', kind: 'text', required: true, placeholder: 'e.g. Identifying high-risk situations' },
    { key: 'interventions', label: 'Interventions used', kind: 'textarea', required: true, placeholder: 'e.g. MI, CBT for SUD, relapse-prevention planning, refusal-skills role play' },
    { key: 'dynamics', label: 'Group process and dynamics', kind: 'textarea', help: 'Describe the group as a whole. Do not name or describe individual members here.' },
    { key: 'plan', label: 'Plan for next session', kind: 'textarea' },
  ],
};

/** Per-attendee section: lands only in that client's own note. */
export const INDIVIDUAL_FIELDS: Record<GroupKind, NoteField[]> = {
  psychotherapy: [
    { key: 'participation', label: 'Participation', kind: 'select', required: true, options: PARTICIPATION_OPTIONS },
    { key: 'moodAffect', label: 'Mood / affect', kind: 'text', placeholder: 'e.g. euthymic, congruent' },
    { key: 'response', label: 'Response to interventions', kind: 'textarea' },
    { key: 'goalIds', label: 'Treatment plan goals addressed', kind: 'goals' },
    { key: 'progress', label: 'Progress toward treatment plan goals', kind: 'textarea', required: true },
    { key: 'risk', label: 'Risk', kind: 'select', required: true, options: RISK_OPTIONS },
    { key: 'riskDetail', label: 'Risk detail / actions taken', kind: 'textarea' },
    { key: 'plan', label: 'Plan', kind: 'textarea' },
  ],
  sud: [
    { key: 'useSinceLast', label: 'Substance use since last session (self-report)', kind: 'select', required: true, options: USE_SINCE_LAST },
    { key: 'useDetail', label: 'Use detail', kind: 'text', placeholder: 'Substance, amount, when (as reported)' },
    { key: 'cravings', label: 'Cravings (0-10)', kind: 'number', min: 0, max: 10 },
    { key: 'triggers', label: 'Triggers identified', kind: 'textarea' },
    { key: 'stageOfChange', label: 'Stage of change', kind: 'select', options: STAGES_OF_CHANGE },
    { key: 'participation', label: 'Participation', kind: 'select', required: true, options: PARTICIPATION_OPTIONS },
    { key: 'goalIds', label: 'SUD treatment plan goals addressed', kind: 'goals' },
    { key: 'progress', label: 'Progress toward SUD treatment plan goals', kind: 'textarea', required: true },
    { key: 'asamDimensions', label: 'ASAM dimension concerns noted', kind: 'multiselect', options: ASAM_DIMENSIONS },
    { key: 'asamDetail', label: 'ASAM concern detail', kind: 'textarea' },
    { key: 'udsSource', label: 'UDS / toxicology', kind: 'select', options: UDS_SOURCES },
    { key: 'udsResult', label: 'UDS / toxicology result', kind: 'text', help: 'Lab results fill in from the Labs module when present.' },
    { key: 'udsDate', label: 'UDS collection date', kind: 'text', placeholder: 'YYYY-MM-DD' },
    { key: 'risk', label: 'Risk', kind: 'select', required: true, options: RISK_OPTIONS },
    { key: 'riskDetail', label: 'Risk detail / actions taken', kind: 'textarea' },
    { key: 'plan', label: 'Plan', kind: 'textarea' },
  ],
};

export type NoteValues = Record<string, string | number | string[] | null | undefined>;

/** Plan goal offered in the individual note (from the client's current treatment plan). */
export type PlanGoalOption = { id: string; text: string };

/** UDS / toxicology result read from the Labs module for the session date window. */
export type LabUdsResult = { resultId: string; testName: string; value: string; flag: string; collectedOn: string | null };
