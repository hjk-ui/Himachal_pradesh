export function operationOutcome(
  severity: 'error' | 'warning' | 'information',
  code: string,
  diagnostics: string
) {
  return {
    resourceType: 'OperationOutcome' as const,
    issue: [
      {
        severity,
        code,
        diagnostics,
      },
    ],
  };
}

/** FHIR server not configured (no SMART_SIGNING_SECRET): 503, never a fixture resource. */
export const FHIR_NOT_CONFIGURED = operationOutcome(
  'error',
  'not-supported',
  'FHIR access is not configured on this server (SMART_SIGNING_SECRET is not set)'
);

// Live Patient / Practitioner resources come from src/lib/fhir/mapping (no defaulted state or NPI).
