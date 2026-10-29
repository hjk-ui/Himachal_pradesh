import 'server-only';

import { getAvailityAccessToken } from './auth';
import { getAvailityConfig } from './config';
import { AvailityEligibilityError } from './errors';

/** HIPAA Transactions Coverages samples use /availity/v1 on api.availity.com */
export function hipaaV1Url(path: string): string {
  const config = getAvailityConfig();
  if (!config) {
    throw new AvailityEligibilityError('Availity is not configured', 503, 'not_configured');
  }
  const base = config.apiBaseUrl.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/availity/v1${suffix}`;
}

/**
 * Official Payer List 1.0.4 (API Guide + demo workflow sample):
 * GET https://api.availity.com/v1/availity-payer-list
 */
export function payerListUrl(search = ''): string {
  const config = getAvailityConfig();
  if (!config) {
    throw new AvailityEligibilityError('Availity is not configured', 503, 'not_configured');
  }
  const base = config.apiBaseUrl.replace(/\/$/, '');
  const query = search.startsWith('?') || search === '' ? search : `?${search}`;
  return `${base}/v1/availity-payer-list${query}`;
}

const SENSITIVE_LOG_KEYS = [
  'token',
  'secret',
  'authorization',
  'password',
  'member',
  'ssn',
  'access_token',
  'client_secret',
];

export function sanitizeAvailityLogBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 3).map(sanitizeAvailityLogBody);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_LOG_KEYS.some((part) => lower.includes(part))) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = sanitizeAvailityLogBody(nested);
  }
  return out;
}

export function logAvailityHttp(label: string, url: string, status: number, payload: unknown) {
  let path = url;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    path = url.replace(/^https?:\/\/[^/]+/i, '');
  }
  console.error(`[availity-eligibility] ${label}`, {
    path,
    status,
    body: sanitizeAvailityLogBody(payload),
  });
}

async function authorizedGet(url: string, extraHeaders?: HeadersInit): Promise<Response> {
  const token = await getAvailityAccessToken();
  const headers = new Headers(extraHeaders);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  try {
    return await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (err instanceof AvailityEligibilityError) throw err;
    console.error('[availity-eligibility] network error', {
      path: url.replace(/^https?:\/\/[^/]+/i, ''),
    });
    throw new AvailityEligibilityError('Availity request failed', 502, 'network');
  }
}

/** Payer List only — no Coverages demo mock headers (not in Payer List docs). */
export async function fetchPayerList(search: string): Promise<Response> {
  return authorizedGet(payerListUrl(search));
}

export async function availityFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = getAvailityConfig();
  if (!config) {
    throw new AvailityEligibilityError('Availity is not configured', 503, 'not_configured');
  }

  const token = await getAvailityAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  // Mock headers only when AVAILITY_COVERAGES_MOCK_SCENARIO_ID is explicitly set (sandbox).
  if (config.coveragesMockScenarioId) {
    headers.set('X-Api-Mock-Scenario-ID', config.coveragesMockScenarioId);
    headers.set('X-Api-Mock-Response', 'true');
  }

  try {
    return await fetch(hipaaV1Url(path), {
      ...init,
      headers,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(45_000),
    });
  } catch (err) {
    if (err instanceof AvailityEligibilityError) throw err;
    throw new AvailityEligibilityError('Availity request failed', 502, 'network');
  }
}

export async function readAvailityJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function parseAvailityFieldErrors(payload: unknown): { field?: string; errorMessage: string }[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const lists = [root.errors, root.validationMessages];
  const out: { field?: string; errorMessage: string }[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const errorMessage =
        typeof row.errorMessage === 'string'
          ? row.errorMessage
          : typeof row.message === 'string'
            ? row.message
            : undefined;
      if (!errorMessage) continue;
      out.push({
        field: typeof row.field === 'string' ? row.field : undefined,
        errorMessage,
      });
    }
  }
  return out;
}
