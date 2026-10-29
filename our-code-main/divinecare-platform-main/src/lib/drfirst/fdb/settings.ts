import { DrFirstError } from '../errors';
import type { FdbSettings } from './types';

const ENGINE_PATH = '/servlet/rcopia.servlet.EngineServlet';

function optional(env: Record<string, string | undefined>, key: string) {
  const value = env[key];
  return value && value.trim() ? value : undefined;
}

function validateEndpoint(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      !/(^|\.)drfirst\.com$/i.test(url.hostname) ||
      url.pathname !== ENGINE_PATH ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) throw new Error('Unsafe DrFirst endpoint');
    return url.toString();
  } catch {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  }
}

/** Pure settings parser. Secrets are never normalized or exposed to the browser. */
export function parseFdbSettings(env: Record<string, string | undefined>): FdbSettings {
  const enabledValue = env.DRFIRST_FDB_ENABLED?.trim().toLowerCase();
  if (enabledValue && !['true', 'false'].includes(enabledValue)) {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  }
  const enabled = enabledValue === 'true';
  const apiVersion = env.DRFIRST_FDB_API_VERSION?.trim() || '2.54';
  if (!/^\d+\.\d+$/.test(apiVersion) || Number(apiVersion) < 1) {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  }

  const settings: FdbSettings = {
    enabled,
    configured: false,
    endpoint: validateEndpoint(optional(env, 'DRFIRST_FDB_URL')),
    vendorName: optional(env, 'DRFIRST_FDB_VENDOR_NAME'),
    vendorPassword: optional(env, 'DRFIRST_FDB_VENDOR_PASSWORD'),
    application: env.DRFIRST_FDB_APPLICATION?.trim() || 'Altrixs',
    applicationVersion: env.DRFIRST_FDB_APPLICATION_VERSION?.trim() || '1.0.0',
    practiceName: optional(env, 'DRFIRST_FDB_PRACTICE_NAME'),
    station: optional(env, 'DRFIRST_FDB_STATION'),
    practiceUsername: optional(env, 'DRFIRST_FDB_PRACTICE_USERNAME'),
    systemName: optional(env, 'DRFIRST_FDB_SYSTEM_NAME'),
    apiVersion,
  };
  settings.configured = Boolean(
    settings.endpoint && settings.vendorName && settings.vendorPassword &&
    settings.practiceUsername && settings.systemName,
  );
  return settings;
}

export function requireFdbSettings(settings: FdbSettings): FdbSettings & {
  endpoint: string;
  vendorName: string;
  vendorPassword: string;
  practiceUsername: string;
  systemName: string;
} {
  if (!settings.enabled || !settings.configured) {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  }
  return settings as FdbSettings & {
    endpoint: string;
    vendorName: string;
    vendorPassword: string;
    practiceUsername: string;
    systemName: string;
  };
}

export function publicFdbStatus(settings: FdbSettings) {
  return { enabled: settings.enabled, configured: settings.enabled && settings.configured, apiVersion: settings.apiVersion };
}
