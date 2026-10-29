export class AvailityEligibilityError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | 'not_configured'
      | 'bad_request'
      | 'missing_payer'
      | 'missing_fields'
      | 'client_not_found'
      | 'availity_validation'
      | 'availity_request_error'
      | 'timeout'
      | 'network'
      | 'rate_limited'
      | 'token_request_failed'
      | 'unexpected',
    readonly details?: { field?: string; errorMessage: string }[]
  ) {
    super(message);
    this.name = 'AvailityEligibilityError';
  }
}
