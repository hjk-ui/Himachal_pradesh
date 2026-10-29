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
  const expectedStatus = environment === 'mock' ? 'SIMULATED' : 'READY';
  const maxLifetime = environment === 'mock' ? MOCK_SESSION_SECONDS * 1000 : 120_000;
  if (parsed.data.status !== expectedStatus || expiresIn <= 0 || expiresIn > maxLifetime) {
    throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  }
  return { ...result, launchUrl, status: parsed.data.status, expiresAt: parsed.data.expiresAt };
}

/** Shared destination policy; the browser need not trust its own clock for session expiry. */
export function getApprovedLaunchUrl(value: unknown, environment: DrFirstEnvironment): string {
  if (environment === 'mock') {
    if (value !== MOCK_LAUNCH_PATH) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
    return MOCK_LAUNCH_PATH;
  }
  if (environment !== 'staging' || typeof value !== 'string') throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'orca.staging.drfirst.com' ||
        url.pathname !== '/orca/auth/extLogin/v10' || url.username || url.password || url.hash ||
        !url.searchParams.get('MAC') || !url.searchParams.get('time')) {
      throw new Error('unsafe');
    }
    return url.toString();
  } catch {
    throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  }
}
