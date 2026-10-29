import 'server-only';

/**
 * Availity env — values from the official Partner OAuth2 docs, not guessed.
 * Token: POST https://api.availity.com/v1/token
 * https://developer.availity.com/blog/2025/3/25/availity-api-guide
 */

function read(key: string): string | undefined {
  const value = process.env[key];
  if (!value || value.trim() === '') return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('your-') || trimmed.startsWith('your_')) return undefined;
  return trimmed;
}

/** Official Coverages 1.0.0 demo scenario IDs (HIPAA Transactions docs). Opt-in only. */
export const AVAILITY_COVERAGES_DEMO_SCENARIOS = [
  'Coverages-Complete-i',
  'Coverages-PayerError1-i',
  'Coverages-InProgress-i',
  'Coverages-Retrying-i',
  'Coverages-PayerError2-i',
  'Coverages-RequestError1-i',
  'Coverages-RequestError2-i',
] as const;

export type AvailityCoveragesDemoScenario =
  (typeof AVAILITY_COVERAGES_DEMO_SCENARIOS)[number];

export type AvailityConfig = {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  apiBaseUrl: string;
  scope: string;
  /**
   * When set, Coverages requests send X-Api-Mock-* headers (sandbox only).
   * Leave unset for production payer responses.
   */
  coveragesMockScenarioId?: AvailityCoveragesDemoScenario;
};

export function getAvailityConfig(): AvailityConfig | null {
  const clientId = read('AVAILITY_CLIENT_ID');
  const clientSecret = read('AVAILITY_CLIENT_SECRET');
  const tokenUrl = read('AVAILITY_TOKEN_URL');
  const apiBaseUrl = read('AVAILITY_API_BASE_URL');
  const scope = read('AVAILITY_SCOPE');

  if (!clientId || !clientSecret || !tokenUrl || !apiBaseUrl || !scope) {
    return null;
  }

  const requested = read('AVAILITY_COVERAGES_MOCK_SCENARIO_ID');
  const coveragesMockScenarioId =
    requested &&
    AVAILITY_COVERAGES_DEMO_SCENARIOS.includes(requested as AvailityCoveragesDemoScenario)
      ? (requested as AvailityCoveragesDemoScenario)
      : undefined;

  return { clientId, clientSecret, tokenUrl, apiBaseUrl, scope, coveragesMockScenarioId };
}

export function isAvailityConfigured(): boolean {
  return getAvailityConfig() !== null;
}
