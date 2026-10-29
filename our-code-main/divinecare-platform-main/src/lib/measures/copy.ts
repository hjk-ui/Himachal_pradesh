/**
 * Measures-to-patients copy — single source for staff UI, patient page, and send reasons.
 * Strings marked "pinned" are exact per the Oct 24 spec; the rest are plain-language
 * defaults kept here so they can be swapped without touching components.
 */

/** pinned */
export function measureEmailSubject(practiceName: string): string {
  return `${practiceName}: a short questionnaire before your visit`;
}

/** Frequencies staff can pick. There is no default: staff must choose one. (Client-safe, no I/O.) */
export const MEASURE_FREQUENCIES = ['once', 'every_visit', 'weekly', 'biweekly', 'monthly'] as const;
export type MeasureFrequency = (typeof MEASURE_FREQUENCIES)[number];

export const ASSIGNMENT_STATUSES = ['active', 'paused', 'completed'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const STAFF_COPY = {
  /** pinned */
  title: 'Measures',
  sendNow: 'Send now',
  giveInSession: 'Give in session',
  markReviewed: (n: number) => `Mark reviewed (${n})`,
  empty: 'No measures on file yet',
} as const;

/** Why a questionnaire was not sent. */
export const NOT_SENT_REASONS = {
  not_found: 'Patient not found.',
  protected_record: 'Protected record.',
  unknown_instrument: 'This measure is not available.',
  item_content_pending: 'This measure’s questions are not available yet, so it cannot be sent.',
  assignment_inactive: 'This measure is paused or completed.',
  no_dob: 'No date of birth on file, so the patient could not verify the link.',
  no_email: 'No email address on file.',
  no_phone: 'No mobile number on file.',
  sms_no_consent: 'The patient has not agreed to text messages.',
  sms_opted_out: 'The patient opted out of text messages.',
  portal_unavailable: 'Patient portal delivery is not available yet.',
  delivery_failed: 'The message could not be delivered.',
} as const;

export type NotSentCode = keyof typeof NOT_SENT_REASONS;

export const CRISIS_BANNER =
  'If you are thinking about hurting yourself or are in crisis, call or text 988 (Suicide & Crisis Lifeline) right now, or call 911. You do not need to wait for your visit.';

export const PATIENT_COPY = {
  verifyTitle: 'Verify your date of birth',
  verifyHelp: 'To protect your privacy, enter your date of birth to open your questionnaire.',
  verifyLabel: 'Date of birth',
  verifyButton: 'Continue',
  verifyWrong: (left: number) =>
    `That date of birth doesn’t match. You have ${left} ${left === 1 ? 'try' : 'tries'} left.`,
  locked: 'This link is locked after too many tries. Please contact your care team.',
  expired: 'This link has expired. Please contact your care team for a new one.',
  invalid: 'This link is not valid. Please contact your care team.',
  progress: (n: number, total: number) => `Question ${n} of ${total}`,
  back: 'Back',
  next: 'Next',
  reviewTitle: 'Review your answers',
  reviewHelp: 'You can change any answer before you send.',
  edit: 'Change',
  submit: 'Send to my care team',
  saving: 'Saving…',
  thanksTitle: 'Thank you',
  thanksBody: 'Your answers were sent to your care team. You can close this page.',
  error: 'Something went wrong. Please try again.',
} as const;
