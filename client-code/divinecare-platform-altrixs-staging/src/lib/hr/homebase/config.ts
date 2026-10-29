/**
 * Homebase (payroll / timekeeping) connector settings, read from process.env the same way the
 * DrFirst settings are (src/lib/drfirst/config.ts). On the servers the values come from AWS
 * Secrets Manager (`altrixs/<env>/homebase`) into the app's environment at start-up.
 *
 * The API key is never logged, returned to the browser, or written to the audit log. Callers get
 * `connected` + a reason; only the HTTP client reads `apiKey`.
 *
 * READ-ONLY: Homebase stays the system of record for pay and time. Altrixs only issues GETs.
 */
export const HOMEBASE_DEFAULT_API_BASE = 'https://api.joinhomebase.com';

export type HomebaseConfig = {
  connected: boolean;
  /** Why the connector is not connected (shown to HR with the how-to-connect steps) */
  reason: 'connected' | 'no_api_key' | 'no_organization' | 'other_organization';
  apiKey: string | null;
  baseUrl: string;
  /** Altrixs organization the key belongs to (HOMEBASE_ORGANIZATION_ID) */
  organizationId: string | null;
  timeoutMs: number;
};

function cleanBase(raw: string | undefined): string {
  const v = (raw || '').trim().replace(/\/+$/, '');
  if (!v) return HOMEBASE_DEFAULT_API_BASE;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return HOMEBASE_DEFAULT_API_BASE;
    return v;
  } catch {
    return HOMEBASE_DEFAULT_API_BASE;
  }
}

/**
 * The Homebase key belongs to one Homebase company, so it is bound to one Altrixs organization
 * (HOMEBASE_ORGANIZATION_ID). Without that binding no organization is connected: a multi-tenant
 * server must never pull one practice's payroll roster into another practice.
 */
export function getHomebaseConfig(forOrganizationId?: string | null, env: NodeJS.ProcessEnv = process.env): HomebaseConfig {
  const apiKey = env.HOMEBASE_API_KEY?.trim() || null;
  const organizationId = env.HOMEBASE_ORGANIZATION_ID?.trim() || null;
  const timeout = Number.parseInt(env.HOMEBASE_TIMEOUT_MS || '', 10);
  const base = {
    apiKey,
    baseUrl: cleanBase(env.HOMEBASE_API_BASE),
    organizationId,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 && timeout <= 120_000 ? timeout : 20_000,
  };
  if (!apiKey) return { ...base, connected: false, reason: 'no_api_key' };
  if (!organizationId) return { ...base, connected: false, reason: 'no_organization' };
  if (forOrganizationId && forOrganizationId !== organizationId) return { ...base, connected: false, reason: 'other_organization' };
  return { ...base, connected: true, reason: 'connected' };
}

export const HOMEBASE_REASON_TEXT: Record<HomebaseConfig['reason'], string> = {
  connected: 'Connected (read-only)',
  no_api_key: 'Not connected: no Homebase API key is configured.',
  no_organization: 'Not connected: the Homebase key is not assigned to this practice (HOMEBASE_ORGANIZATION_ID).',
  other_organization: 'Not connected: the Homebase key on this server belongs to a different practice.',
};
