/**
 * Homebase public API client — READ ONLY.
 * - Only GET requests exist here; there is no method parameter, so nothing can be written outbound.
 * - Responses are whitelisted into minimal shapes. Wages, SSNs, emails and phone numbers are dropped on
 *   the way in and never stored or returned.
 * - Never returns sample data: when not configured, `getHomebaseConfig()` is null and callers return empties.
 */

export type HomebaseConfig = {
  apiKey: string;
  /** The Altrixs clinic organization that owns this Homebase connection. */
  organizationId: string;
  baseUrl: string;
  timeoutMs: number;
};

const DEFAULT_BASE = 'https://app.joinhomebase.com/api/public';
const DEFAULT_TIMEOUT_MS = 15_000;

export function getHomebaseConfig(env: NodeJS.ProcessEnv = process.env): HomebaseConfig | null {
  const apiKey = env.HOMEBASE_API_KEY?.trim();
  const organizationId = env.HOMEBASE_ORGANIZATION_ID?.trim();
  if (!apiKey || !organizationId) return null;
  const timeout = Number(env.HOMEBASE_TIMEOUT_MS);
  return {
    apiKey,
    organizationId,
    baseUrl: (env.HOMEBASE_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, ''),
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

/** Connected = configured, and configured for this clinic organization. */
export function getHomebaseConfigFor(organizationId: string): HomebaseConfig | null {
  const config = getHomebaseConfig();
  return config && config.organizationId === organizationId ? config : null;
}

export class HomebaseError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'HomebaseError';
  }
}

export type HomebaseLocation = { id: string; name: string };
export type HomebaseEmployee = { id: string; locationId: string; name: string };
export type HomebaseTimecard = {
  id: string;
  locationId: string;
  employeeId: string;
  /** YYYY-MM-DD of clock-in */
  date: string;
  regularHours: number;
  overtimeHours: number;
};

async function get(config: HomebaseConfig, path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new HomebaseError(`Homebase returned ${res.status}`, res.status);
    return await res.json();
  } catch (err) {
    if (err instanceof HomebaseError) throw err;
    if (err instanceof Error && err.name === 'AbortError') throw new HomebaseError('Homebase did not respond in time');
    throw new HomebaseError('Could not reach Homebase');
  } finally {
    clearTimeout(timer);
  }
}

const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export async function listHomebaseLocations(config: HomebaseConfig): Promise<HomebaseLocation[]> {
  const rows = asArray(await get(config, '/locations'));
  return rows
    .map((r) => ({ id: str(r.uuid ?? r.id), name: str(r.name) }))
    .filter((l) => l.id);
}

export async function listHomebaseEmployees(config: HomebaseConfig, locationId: string): Promise<HomebaseEmployee[]> {
  const rows = asArray(await get(config, `/locations/${encodeURIComponent(locationId)}/employees`));
  return rows
    .map((r) => ({
      id: str(r.id ?? r.uuid),
      locationId,
      name: `${str(r.first_name)} ${str(r.last_name)}`.trim(),
    }))
    .filter((e) => e.id);
}

/** Hours only — wage fields on the timecard are never read. */
export async function listHomebaseTimecards(
  config: HomebaseConfig,
  locationId: string,
  range: { start: string; end: string }
): Promise<HomebaseTimecard[]> {
  const rows = asArray(
    await get(config, `/locations/${encodeURIComponent(locationId)}/timecards`, {
      start_date: range.start,
      end_date: range.end,
    })
  );
  return rows
    .map((r) => {
      const labor = (r.labor && typeof r.labor === 'object' ? r.labor : {}) as Record<string, unknown>;
      const clockIn = str(r.clock_in);
      return {
        id: str(r.id),
        locationId,
        employeeId: str(r.user_id ?? r.employee_id),
        date: clockIn.slice(0, 10),
        regularHours: num(labor.regular_hours),
        overtimeHours: num(labor.overtime_hours),
      };
    })
    .filter((t) => t.id && t.employeeId);
}
