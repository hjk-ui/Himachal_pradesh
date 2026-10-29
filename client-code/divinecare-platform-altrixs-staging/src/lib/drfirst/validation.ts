import { z } from 'zod';
import { DrFirstError } from './errors';
import type { DrFirstEnvironment, IntegrationResult, SsoLaunchResult } from './types';

export const MOCK_LAUNCH_PATH = '/dashboard/ehr/prescriptions/mock';
export const MOCK_SESSION_SECONDS = 300;
const externalId = z.string().min(1).max(200).regex(/^\S+$/);
const resultSchema = z.object({ externalId, environment: z.enum(['mock', 'staging', 'production']), mode: z.enum(['MOCK', 'LIVE']) });
const launchSchema = resultSchema.extend({ launchUrl: z.string(), status: z.enum(['SIMULATED', 'READY']), expiresAt: z.string().datetime() });

/** Whitelist internal results before persistence/HTTP; never forward extra adapter fields. */
export function validateIntegrationResult(value: unknown, environment: DrFirstEnvironment): IntegrationResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success || parsed.data.environment !== environment || parsed.data.mode !== (environment === 'mock' ? 'MOCK' : 'LIVE') ||
    parsed.data.externalId.startsWith('mock_') !== (environment === 'mock')) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  return parsed.data as IntegrationResult;
}

export function validateLaunchResult(value: unknown, environment: DrFirstEnvironment): SsoLaunchResult {
  const parsed = launchSchema.safeParse(value);
  if (!parsed.success) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  const result = validateIntegrationResult(parsed.data, environment);
  const expiresIn = Date.parse(parsed.data.expiresAt) - Date.now();
  // No external redirect destination is approved yet. Extend only from the official SSO contract.
  const launchUrl = getApprovedLaunchUrl(parsed.data.launchUrl, environment);
  if (parsed.data.status !== 'SIMULATED' || expiresIn <= 0 || expiresIn > MOCK_SESSION_SECONDS * 1000) {
    throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  }
  return { ...result, launchUrl, status: parsed.data.status, expiresAt: parsed.data.expiresAt };
}

/** Shared destination policy; the browser need not trust its own clock for session expiry. */
export function getApprovedLaunchUrl(value: unknown, environment: DrFirstEnvironment): string {
  if (environment !== 'mock') throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  if (value !== MOCK_LAUNCH_PATH) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  return MOCK_LAUNCH_PATH;
}
