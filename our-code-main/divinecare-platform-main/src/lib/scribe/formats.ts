/** Prescriber-first scribe formats (Oct 23). */

export const SCRIBE_FORMATS = [
  {
    key: 'PSYCH_MED_MGMT',
    label: 'Psychiatric Med Management / follow-up (E/M ± 90833 / 90836 / 90838)',
    group: 'Your templates' as const,
  },
  {
    key: 'MED_MGMT',
    label: 'Medication Management (E/M)',
    group: 'Your templates' as const,
  },
  {
    key: 'PSYCH_EVAL',
    label: 'Psychiatric Evaluation (90792)',
    group: 'Your templates' as const,
  },
  {
    key: 'ADULT_PSYCH_INTAKE',
    label: 'Adult Psychiatric Intake',
    group: 'Your templates' as const,
  },
  {
    key: 'CHILD_PSYCH_INTAKE',
    label: 'Child Psychiatric Intake',
    group: 'Your templates' as const,
  },
  {
    key: 'ADULT_PSYCH_REEVAL',
    label: 'Adult Psychiatric Re-Eval',
    group: 'Your templates' as const,
  },
  {
    key: 'CHILD_PSYCH_REEVAL',
    label: 'Child Psychiatric Re-Eval',
    group: 'Your templates' as const,
  },
  {
    key: 'PRIMARY_CARE_SOAP',
    label: 'Primary care SOAP (E/M)',
    group: 'Your templates' as const,
  },
  { key: 'SOAP', label: 'SOAP (therapy)', group: 'More templates' as const },
  { key: 'DAP', label: 'DAP', group: 'More templates' as const },
  { key: 'BIRP', label: 'BIRP', group: 'More templates' as const },
] as const;

export type ScribeFormatKey = (typeof SCRIBE_FORMATS)[number]['key'];

export const TEMPLATE_CUES_TITLE = 'Template cues';
export const TEMPLATE_CUES_SUB =
  'What this note asks for. Cues only: they are not sent to the AI and do not change the draft.';
export const YOU_COMPLETE_BADGE = 'You complete';

export const NEVER_AI_HEADINGS = [
  'Identifying Information',
  'Risk / safety',
  'Diagnoses',
  'Labs',
  'ASAM',
  'ROI',
  'Medication plan',
] as const;

/** Bedrock / draft prompt version (Oct 25 field feedback). */
export const SCRIBE_DRAFT_PROMPT_VERSION = 'scribe-draft-2026-10-25';

export const NO_MED_CHANGES_SENTENCE =
  'No medication changes this visit; continue current medications as prescribed.';

export const DISMISS_SCRIBE_BTN = 'Dismiss scribe';
export const DISMISS_SCRIBE_CONFIRM =
  'Stop and discard this recording? Nothing from it will be kept.';
export const DISMISS_SCRIBE_CTA = 'Stop and discard';
export const DISMISS_SCRIBE_CANCEL = 'Keep it';
export const DISMISS_SCRIBE_AFTER =
  'AI Scribe dismissed: recording stopped and nothing from it was kept. Write the note yourself.';

/** Default format: PSYCH_MED_MGMT for PSYCHIATRIST/NP. */
export function defaultScribeFormat(role?: string | null): ScribeFormatKey {
  if (role === 'PSYCHIATRIST' || role === 'NP' || role === 'MEDICAL_NP') {
    return 'PSYCH_MED_MGMT';
  }
  return 'SOAP';
}

export function visitGuideHint(label: string) {
  return `From the visit: ${label}`;
}
