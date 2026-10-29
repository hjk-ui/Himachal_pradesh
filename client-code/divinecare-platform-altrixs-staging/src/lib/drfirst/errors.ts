export const messages = {
  DRFIRST_DISABLED: 'DrFirst integration is disabled.',
  DRFIRST_NOT_CONFIGURED: 'Official DrFirst credentials and integration documentation are required.',
  DRFIRST_UNAUTHORIZED: 'You are not authorized to perform this action.',
  DRFIRST_PATIENT_INVALID: 'Patient name and a valid date of birth are required.',
  DRFIRST_PRESCRIBER_INVALID: 'Prescriber name is required; an NPI, when supplied, must have 10 digits.',
  DRFIRST_EXTERNAL_SERVICE_ERROR: 'DrFirst service is unavailable. Please try again later.',
  DRFIRST_INVALID_INPUT: 'Invalid integration request.',
  DRFIRST_SESSION_EXPIRED: 'Your mock session has expired. Return to prescriptions and launch again.',
} as const;
export type DrFirstErrorCode = keyof typeof messages;
export class DrFirstError extends Error {
  constructor(public readonly code: DrFirstErrorCode, public readonly status = 400) { super(messages[code]); }
}
export function safeDrFirstError(error: unknown) {
  return error instanceof DrFirstError ? error : new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
}
