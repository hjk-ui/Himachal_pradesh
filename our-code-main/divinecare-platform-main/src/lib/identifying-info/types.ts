/**
 * Identifying Information (Oct 25) — shared types.
 * Pure types only: safe to import from client components and server routes.
 */

export const IDENTIFYING_FIELD_KEYS = [
  'title',
  'sexAssignedAtBirth',
  'genderIdentity',
  'pronouns',
  'age',
  'race',
  'ethnicity',
  'maritalStatus',
  'legalGuardian',
  'preferredLanguage',
  'interpreterNeeded',
  'visitModality',
  'patientLocation',
  'accompaniedBy',
  'weight',
  'height',
  'bmi',
  'chiefComplaint',
] as const;

export type IdentifyingFieldKey = (typeof IDENTIFYING_FIELD_KEYS)[number];

export const VISIT_MODALITIES = ['in_office', 'telehealth_video', 'telehealth_audio'] as const;
export type VisitModality = (typeof VISIT_MODALITIES)[number];

/** Where a prefilled / edited value came from. Drives the grey source tag next to the field. */
export type IdentifyingSource =
  | 'chart'
  | 'appointment'
  | 'vitals'
  | 'lastEvaluation'
  | 'draft'
  | 'scribe';

/** Blank / missing = omitted. Values are never defaulted to "unknown". */
export type IdentifyingValues = Partial<Record<IdentifyingFieldKey, string>>;
export type IdentifyingSources = Partial<Record<IdentifyingFieldKey, IdentifyingSource>>;

export type IdentifyingState = {
  values: IdentifyingValues;
  sources: IdentifyingSources;
};

/** Chart demographics the client record actually holds. */
export type IdentifyingChartData = {
  namePrefix: string | null;
  /** Client.gender — surfaced as "Gender identity". */
  gender: string | null;
  /** YYYY-MM-DD */
  dateOfBirth: string | null;
};

/** Most recent recorded vitals row (all null when none on file). */
export type IdentifyingVitals = {
  weightLbs: number | null;
  heightInches: number | null;
  bmi: number | null;
  recordedAt: string | null;
};

/** Last signed, non-Part 2 evaluation that carried an Identifying Information section. */
export type IdentifyingPriorEvaluation = {
  noteId: string;
  /** ISO timestamp the prior evaluation was signed (falls back to created). */
  date: string;
  values: IdentifyingValues;
};

export type IdentifyingVisit = {
  appointmentId: string | null;
  modality: VisitModality | null;
};

/** GET /api/clients/[id]/identifying-info */
export type IdentifyingInfoPayload = {
  chart: IdentifyingChartData;
  vitals: IdentifyingVitals | null;
  prior: IdentifyingPriorEvaluation | null;
  visit: IdentifyingVisit | null;
  canUpdateChart: boolean;
};

export type SignIssueCode =
  | 'chief_complaint'
  | 'visit_modality'
  | 'guardian_blank'
  | 'guardian_self';

export type SignIssueSeverity = 'warn' | 'block';

export type SignIssue = {
  code: SignIssueCode;
  fieldKey: IdentifyingFieldKey;
  message: string;
  severity: SignIssueSeverity;
};

/** Fields that can be written back to the client chart. */
export type ChartDemographicsChanges = {
  title?: string;
  genderIdentity?: string;
};
