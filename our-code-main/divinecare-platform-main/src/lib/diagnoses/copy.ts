/** Exact UI / API copy for the diagnosis list (Oct 24). Do not paraphrase. */

export const DIAGNOSIS_COPY = {
  title: 'Diagnosis list',
  reviewedNoChange: 'Reviewed — no change',
  history: 'History',
  addDiagnosis: 'Add diagnosis',
  empty: 'No current diagnosis on the list.',
  searchPlaceholder: 'ICD-10-CM code or words (FY2027)',
  /** DELETE → 405 */
  noDelete:
    'Diagnoses are not deleted. Resolve it, rule it out, or mark it entered in error; the history is kept.',
  codeImmutable:
    'The code cannot be changed after it is added. Add the new code, then resolve or rule out this one.',
  primaryRequired: 'Choose another diagnosis as primary instead.',
  duplicateCurrent: 'This code is already on the current list.',
  invalidCode: 'Enter a valid ICD-10-CM code, for example F41.1.',
} as const;

export const DIAGNOSIS_STATUS_LABELS = {
  ACTIVE: 'Active',
  PROVISIONAL: 'Provisional',
  RULED_OUT: 'Ruled out',
  RESOLVED: 'Resolved',
  ENTERED_IN_ERROR: 'Entered in error',
} as const;

export const DIAGNOSIS_PILLS = {
  primary: 'Primary',
  needsCoding: 'Needs coding',
  reviewDue: 'Review due',
} as const;
