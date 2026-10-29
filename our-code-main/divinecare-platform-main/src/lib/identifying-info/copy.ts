/**
 * Identifying Information (Oct 25) — exact user-facing strings.
 * Keep verbatim: tests and the staging snapshot compare against these.
 */
import type { IdentifyingSource } from './types';

export const IDENTIFYING_INFORMATION_HEADING = 'Identifying Information';

/** Source tags shown next to a prefilled field. */
export const SOURCE_TAGS: Record<IdentifyingSource, string> = {
  chart: '(from chart)',
  appointment: '(from appointment)',
  vitals: '(from chart vitals)',
  lastEvaluation: '(from last evaluation)',
  draft: '(saved draft)',
  scribe: '(AI Scribe suggestion — reviewed by you)',
};

/** Sign issues (exact). */
export const SIGN_ISSUE_CHIEF_COMPLAINT =
  "Identifying Information: record the chief complaint in the patient's own words.";
export const SIGN_ISSUE_VISIT_MODALITY =
  'Identifying Information: choose the visit modality (in office, telehealth video or telehealth audio-only).';
export const SIGN_ISSUE_GUARDIAN_BLANK =
  'Identifying Information: this patient is a minor — record the legal guardian.';
export const SIGN_ISSUE_GUARDIAN_SELF =
  'Identifying Information: a minor cannot be their own legal guardian — record the parent or legal guardian instead of "Self".';

/** Update chart demographics (violet panel). */
export const UPDATE_CHART_TITLE = 'Update chart demographics';
export const UPDATE_CHART_BODY =
  'These values differ from the client chart. Update the chart so the next note starts from them. Blank fields never clear the chart, and AI Scribe suggestions are not written to it.';
export const UPDATE_CHART_BUTTON = 'Update chart demographics';
export const UPDATE_CHART_SAVING = 'Updating…';
export const UPDATE_CHART_DONE = 'Chart demographics updated.';
export const UPDATE_CHART_FAILED = 'Could not update chart demographics.';
export const ROLE_CANNOT_EDIT_CHART =
  'Your role cannot change chart demographics; ask the front desk to update the profile.';

/** Re-eval amber line: `date` is already formatted for display. */
export function changedSinceLastEvaluation(date: string, was: string): string {
  return `Changed since last evaluation (${date}): was ${was}`;
}

export const IDENTIFYING_LOADING = 'Loading chart demographics…';
export const IDENTIFYING_LOAD_FAILED = 'Could not load chart demographics. You can still fill this section in by hand.';
