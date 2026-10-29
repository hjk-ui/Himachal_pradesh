/** Integration log constants (client-safe: no Node imports). */
export const INTEGRATIONS = [
  'drfirst',
  'waystar',
  'availity',
  'sms',
  'email',
  'stripe',
  'homebase',
  'bedrock',
  'textract',
  'transcribe',
  'chime',
  'healthlake',
  'cron',
] as const;
export type IntegrationName = (typeof INTEGRATIONS)[number];

export const INTEGRATION_LABELS: Record<IntegrationName, string> = {
  drfirst: 'DrFirst Rcopia',
  waystar: 'Waystar (SFTP)',
  availity: 'Availity eligibility',
  sms: 'SMS (AWS)',
  email: 'Email (SES)',
  stripe: 'Stripe',
  homebase: 'Homebase',
  bedrock: 'Bedrock AI',
  textract: 'Textract OCR',
  transcribe: 'Transcribe',
  chime: 'Chime telehealth',
  healthlake: 'HealthLake FHIR',
  cron: 'Scheduled jobs',
};

export const CALL_STATUSES = ['success', 'error', 'throttled', 'skipped'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const CALL_DIRECTIONS = ['outbound', 'inbound', 'webhook', 'job'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];
