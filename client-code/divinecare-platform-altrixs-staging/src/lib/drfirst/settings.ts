import { DrFirstError } from './errors';
import type { ConnectionStatus, DrFirstEnvironment, MockFailure } from './types';

/** Pure parser; only config.ts reads the process environment. */
export function parseDrFirstSettings(env: Record<string, string | undefined>) {
  const enabledValue = env.DRFIRST_ENABLED?.trim().toLowerCase();
  const environmentValue = env.DRFIRST_ENV?.trim().toLowerCase();
  const productionRuntime = env.NODE_ENV === 'production';
  if (enabledValue && !['true', 'false'].includes(enabledValue)) throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  const enabled = enabledValue === 'true';
  if (enabled && productionRuntime && !environmentValue) throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  const environment = environmentValue || 'mock';
  if (!['mock', 'staging', 'production'].includes(environment)) throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  const mockFailure = env.DRFIRST_MOCK_FAILURE?.trim().toLowerCase() || 'none';
  if (!['none', 'patient', 'prescriber', 'unavailable'].includes(mockFailure)) throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  const allowMockFailures = !productionRuntime && environment === 'mock';
  if (mockFailure !== 'none' && !allowMockFailures) throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  return { enabled, environment: environment as DrFirstEnvironment, mockFailure: mockFailure as MockFailure, productionRuntime, allowMockFailures };
}
export function publicDrFirstStatus(config: { enabled: boolean; environment: DrFirstEnvironment }): ConnectionStatus {
  // The mock is never "configured" DrFirst, and staging / production fail closed until the official
  // provider exists (factory.ts), so no real connection is reported here.
  return { enabled: config.enabled, environment: config.environment, configured: false, mock: config.enabled && config.environment === 'mock' };
}
