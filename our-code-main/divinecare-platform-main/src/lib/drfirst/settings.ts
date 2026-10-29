import { DrFirstError } from './errors';
import type { ConnectionStatus, DrFirstEnvironment, MockFailure } from './types';

const ENGINE_PATH = '/servlet/rcopia.servlet.EngineServlet';
const STAGING_SSO_HOST = 'orca.staging.drfirst.com';

function optional(env: Record<string, string | undefined>, key: string) {
  const value = env[key]?.trim();
  return value || undefined;
}

function safeUrl(value: string | undefined, kind: 'engine' | 'sso') {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const safe = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    if (!safe) throw new Error('unsafe');
    if (kind === 'engine' && (!/(^|\.)drfirst\.com$/i.test(url.hostname) || url.pathname !== ENGINE_PATH)) throw new Error('unsafe');
    if (kind === 'sso' && (url.hostname !== STAGING_SSO_HOST || url.pathname !== '/orca/auth/extLogin/v10')) throw new Error('unsafe');
    return url.toString();
  } catch {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  }
}

function externalIdMap(value: string | undefined) {
  if (!value) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('invalid');
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([key, id]) => !key.trim() || typeof id !== 'string' || !/^[-._A-Za-z0-9]{1,100}$/.test(id))) throw new Error('invalid');
    return Object.fromEntries(entries.map(([key, id]) => [key.trim().toLowerCase(), String(id)]));
  } catch {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  }
}

function validAuditKey(value?: string) {
  if (!value) return false;
  if (/^[a-f0-9]{64}$/i.test(value)) return true;
  try { return Buffer.from(value, 'base64').length === 32; } catch { return false; }
}

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
  const engineUrl = safeUrl(optional(env, 'DRFIRST_ENGINE_URL'), 'engine');
  const updateUrl = safeUrl(optional(env, 'DRFIRST_UPDATE_URL'), 'engine');
  const ssoUrl = safeUrl(optional(env, 'DRFIRST_SSO_URL'), 'sso');
  const vendorUsername = optional(env, 'DRFIRST_VENDOR_USERNAME');
  const vendorPassword = optional(env, 'DRFIRST_VENDOR_PASSWORD');
  const practiceUsername = optional(env, 'DRFIRST_PRACTICE_USERNAME');
  const practiceName = optional(env, 'DRFIRST_PRACTICE_NAME');
  const systemName = optional(env, 'DRFIRST_PORTAL_SYSTEM_NAME');
  const auditEncryptionKey = optional(env, 'DRFIRST_AUDIT_ENCRYPTION_KEY');
  const prescriberMap = externalIdMap(optional(env, 'DRFIRST_PRESCRIBER_MAP_JSON'));
  const patientMap = externalIdMap(optional(env, 'DRFIRST_PATIENT_MAP_JSON'));
  const auditRetentionDays = Number(optional(env, 'DRFIRST_AUDIT_RETENTION_DAYS') || '90');
  if (!Number.isInteger(auditRetentionDays) || auditRetentionDays < 1 || auditRetentionDays > 3650) {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  }
  const stagingConfigured = Boolean(
    engineUrl && updateUrl && ssoUrl && vendorUsername && vendorPassword && practiceUsername && systemName &&
    validAuditKey(auditEncryptionKey) && Object.keys(prescriberMap).length,
  );
  /** true | non_imported | off (unset) — Oct 21 staging default non_imported */
  const registerRaw = (optional(env, 'DRFIRST_REGISTER_ON_LAUNCH') || '').toLowerCase();
  const registerOnLaunch =
    registerRaw === 'true' ? 'true' : registerRaw === 'non_imported' ? 'non_imported' : 'off';
  return {
    enabled,
    environment: environment as DrFirstEnvironment,
    mockFailure: mockFailure as MockFailure,
    productionRuntime,
    allowMockFailures,
    engineUrl,
    updateUrl,
    ssoUrl,
    vendorUsername,
    vendorPassword,
    practiceUsername,
    practiceName,
    systemName,
    auditEncryptionKey,
    auditRetentionDays,
    prescriberMap,
    patientMap,
    stagingConfigured,
    registerOnLaunch: registerOnLaunch as 'true' | 'non_imported' | 'off',
  };
}
export function publicDrFirstStatus(config: { enabled: boolean; environment: DrFirstEnvironment; stagingConfigured?: boolean }): ConnectionStatus {
  return {
    enabled: config.enabled,
    environment: config.environment,
    configured: config.enabled && (config.environment === 'mock' || (config.environment === 'staging' && config.stagingConfigured === true)),
  };
}
