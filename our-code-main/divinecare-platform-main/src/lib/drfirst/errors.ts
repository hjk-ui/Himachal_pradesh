export const messages = {
  DRFIRST_DISABLED: 'DrFirst integration is disabled.',
  DRFIRST_NOT_CONFIGURED: 'Official DrFirst credentials and integration documentation are required.',
  DRFIRST_UNAUTHORIZED: 'You are not authorized to perform this action.',
  DRFIRST_PATIENT_INVALID: 'Patient legal name and a valid date of birth are required.',
  DRFIRST_DEMOGRAPHICS_INCOMPLETE:
    "DrFirst was not opened: add the missing demographics to this patient's chart (Edit demographics), then open DrFirst again. DrFirst needs them to create the patient.",
  DRFIRST_UPLOAD_FAILED:
    'DrFirst was not opened: the patient could not be updated in DrFirst first (upload failed).',
  DRFIRST_REGISTER_BLOCKED: 'Register-on-launch is off or this patient is excluded (imported).',
  DRFIRST_PRESCRIBER_INVALID: 'Prescriber is not mapped to an enrolled DrFirst staging account.',
  DRFIRST_EXTERNAL_SERVICE_ERROR: 'DrFirst service is unavailable. Please try again later.',
  DRFIRST_UPSTREAM_REJECTED: 'DrFirst rejected the request. Verify the configured identifiers and submitted data.',
  DRFIRST_INVALID_INPUT: 'Invalid integration request.',
  DRFIRST_SESSION_EXPIRED: 'Your mock session has expired. Return to prescriptions and launch again.',
} as const;
export type DrFirstErrorCode = keyof typeof messages;
export class DrFirstError extends Error {
  readonly detail?: string;
  readonly missingFields?: string[];
  constructor(
    public readonly code: DrFirstErrorCode,
    public readonly status = 400,
    detail?: string,
    missingFields?: string[]
  ) {
    super(messages[code]);
    this.detail = detail?.trim() || undefined;
    this.missingFields = missingFields?.length ? missingFields : undefined;
  }
}
export function safeDrFirstError(error: unknown) {
  return error instanceof DrFirstError ? error : new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
}
