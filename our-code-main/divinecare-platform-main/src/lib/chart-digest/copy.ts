/** Chart history digest copy — single source for the API, the card, and tests. */

export const CHART_HISTORY_TITLE = 'Chart history';
export const CHART_DIGEST_DISCLAIMER = 'AI-generated from chart documents — verify before relying on it';
export const CHART_DIGEST_EMPTY = 'No chart history yet';
export const GENERATE_LABEL = 'Generate';
export const REGENERATE_LABEL = 'Regenerate';

export const SESSION_TAB_VISIT_GUIDE = 'Visit guide';
export const SESSION_TAB_CHART_HISTORY = 'Chart history';
export const SESSION_TAB_MEDICAL_HISTORY = 'Medical history';
export const SESSION_TAB_BH_HISTORY = 'Behavioral health history';

export const DIGEST_DENIAL_CODES = [
  'role_not_permitted',
  'not_on_care_team',
  'ai_consent_declined',
  'ai_not_configured',
  'sensitive_record',
] as const;

export type DigestDenialCode = (typeof DIGEST_DENIAL_CODES)[number];

export const DIGEST_DENIAL_MESSAGES: Record<DigestDenialCode, string> = {
  role_not_permitted: 'Your role cannot view this chart history.',
  not_on_care_team: 'Chart history is limited to the patient’s care team.',
  ai_consent_declined: 'This client declined AI use, so no chart history is generated.',
  ai_not_configured: 'AI is not configured for this practice.',
  sensitive_record: 'This is a protected record. Chart history is not available.',
};

/** HTTP status for each denial. */
export const DIGEST_DENIAL_STATUS: Record<DigestDenialCode, number> = {
  role_not_permitted: 403,
  not_on_care_team: 403,
  ai_consent_declined: 403,
  ai_not_configured: 503,
  sensitive_record: 403,
};
