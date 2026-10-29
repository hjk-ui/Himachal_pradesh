/** Progress note metadata stored as ProgressNote columns. Every save path sends what it knows. */
export type NoteMeta = {
  noteType?: string | null;
  /** YYYY-MM-DD */
  dateOfService?: string | null;
  durationMinutes?: number | null;
  cptCode?: string | null;
  placeOfService?: string | null;
  telehealth?: boolean;
  /** Telehealth by audio only (no video): payer audio-only modifier on the claim */
  audioOnly?: boolean;
  /** Psychiatric E/M note: psychotherapy add-on (90833 / 90836 / 90838) billed as a second line */
  addOnCptCode?: '90833' | '90836' | '90838' | '' | null;
  /** Psychotherapy minutes documented separately from the E/M */
  psychotherapyMinutes?: number | null;
  /** Create only: the appointment the note was started from (claims cross-check clinician + date) */
  appointmentId?: string | null;
  part2?: boolean;
  /** True when any part of the note came from an AI draft */
  aiDrafted?: boolean;
};

export const ADDENDUM_REASONS = [
  'Clinical clarification',
  'Late entry',
  'Correction of error',
  'Additional information received',
  /** Accepted patient request to amend the record (45 CFR 164.526); the original stays unchanged */
  'Patient-requested amendment (HIPAA)',
] as const;

/** Addendum reason used when a patient amendment request is accepted. */
export const AMENDMENT_ADDENDUM_REASON = 'Patient-requested amendment (HIPAA)' as const;

/**
 * Correction vs addendum (both leave the signed note unchanged): "Correction of error" states what
 * was wrong and the corrected information; the original stays visible in the record.
 */
export const CORRECTION_REASON = 'Correction of error' as const;
