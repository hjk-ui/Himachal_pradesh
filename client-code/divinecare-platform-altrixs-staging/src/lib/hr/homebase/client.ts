/**
 * Homebase Public API client (READ-ONLY: GET requests only).
 *
 *  - Headers: Authorization: Bearer <key>, Accept: application/vnd.homebase-v1+json.
 *  - Pagination: response headers Total / Per-Page / Link (RFC 5988 rel="next" / rel="last");
 *    query `page` + `per_page`. Next links are followed only on the configured API origin, so the
 *    bearer key is never sent to another host.
 *  - Rate limit: Homebase allows 60 requests / minute per UUID in the URL and answers 429
 *    {"error":"Rate limit exceeded"}. A per-UUID sliding-window limiter keeps us at <= 50 / min
 *    (headroom), and a 429 is retried with backoff (Retry-After when sent, else exponential).
 *  - Timeouts via AbortController. Errors never include the key.
 *
 * Base URL: Homebase's docs give both https://api.joinhomebase.com and "base url /api/public".
 * HOMEBASE_API_BASE overrides the default (e.g. https://app.joinhomebase.com/api/public) once the
 * key is issued and the right base is confirmed with a GET /company.
 */
import { getHomebaseConfig, type HomebaseConfig } from './config';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';

export const HOMEBASE_ACCEPT = 'application/vnd.homebase-v1+json';
export const HOMEBASE_RATE_LIMIT_PER_MIN = 50;
const MAX_PAGES = 200;

// ─── Link header (RFC 5988) ──────────────────────────────────────────────────

/** `<url>; rel="next", <url>; rel="last"` → { next: url, last: url }. Tolerates spacing / quoting. */
export function parseLinkHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(/,(?=\s*<)/)) {
    const m = /<([^>]*)>(.*)/.exec(part.trim());
    if (!m) continue;
    const url = m[1].trim();
    const relMatch = /;\s*rel\s*=\s*"?([^";]+)"?/i.exec(m[2]);
    if (!url || !relMatch) continue;
    for (const rel of relMatch[1].trim().split(/\s+/)) out[rel.toLowerCase()] = url;
  }
  return out;
}

// ─── Rate limiter (per UUID in the URL) ──────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Rate-limit bucket for a path: the first UUID in it (Homebase counts per UUID), else "global". */
export function rateLimitKey(path: string): string {
  return UUID_RE.exec(path)?.[0].toLowerCase() ?? 'global';
}

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** Sliding window: at most `limit` acquisitions per `windowMs` per key. Calls are sequential. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit = HOMEBASE_RATE_LIMIT_PER_MIN,
    private readonly windowMs = 60_000,
    private readonly clock: Clock = realClock,
  ) {}

  async acquire(key: string): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
      if (list.length < this.limit) {
        list.push(now);
        this.hits.set(key, list);
        return;
      }
      this.hits.set(key, list);
      await this.clock.sleep(Math.max(1, list[0] + this.windowMs - now));
    }
  }
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class HomebaseApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = 'HomebaseApiError';
  }
}

export class HomebaseNotConnectedError extends Error {
  constructor(readonly reason: HomebaseConfig['reason']) {
    super('Homebase is not connected');
    this.name = 'HomebaseNotConnectedError';
  }
}

function errorText(status: number): string {
  if (status === 401) return 'Homebase rejected the API key (401). Check the key in Secrets Manager.';
  if (status === 403) return 'The Homebase API key is not allowed to read this (403).';
  if (status === 404) return 'Homebase returned 404 (check HOMEBASE_API_BASE and the location).';
  if (status === 429) return 'Homebase rate limit exceeded; try again in a minute.';
  if (status >= 500) return `Homebase is unavailable (${status}).`;
  return `Homebase request failed (${status}).`;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export type Query = Record<string, string | number | boolean | null | undefined>;
export type FetchLike = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text?(): Promise<string>;
}>;

export type HomebaseClientOptions = {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  clock?: Clock;
  limiter?: RateLimiter;
  /** Retries after a 429 (default 5) */
  maxRateLimitRetries?: number;
  /** Retries after a 502 / 503 / 504 or network error (default 2) */
  maxServerRetries?: number;
  perPage?: number;
  /** Set by homebaseClientFor: each request is recorded in the integration call log (no bodies) */
  organizationId?: string;
};

export type PageResult = { items: unknown[]; total: number | null; perPage: number | null; pages: number };

/** List payloads arrive as an array or wrapped ({ data: [...] }, { employees: [...] } ...): unwrap. */
export function unwrapList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const k of ['data', 'items', 'results', 'employees', 'shifts', 'timecards', 'locations', 'deleted']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

export class HomebaseClient {
  private readonly base: URL;
  private readonly fetchImpl: FetchLike;
  private readonly clock: Clock;
  private readonly limiter: RateLimiter;
  /** Requests sent (tests / sync counters) */
  requestCount = 0;

  constructor(private readonly opts: HomebaseClientOptions) {
    this.base = new URL(opts.baseUrl.replace(/\/+$/, '') + '/');
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.clock = opts.clock ?? realClock;
    this.limiter = opts.limiter ?? new RateLimiter(HOMEBASE_RATE_LIMIT_PER_MIN, 60_000, this.clock);
  }

  /** Absolute URL for an API path (keeps the base path, e.g. /api/public). */
  url(path: string, query: Query = {}): string {
    const u = new URL(path.replace(/^\/+/, ''), this.base);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
  }

  private sameOrigin(url: string): boolean {
    try {
      const u = new URL(url, this.base);
      return u.origin === this.base.origin;
    } catch {
      return false;
    }
  }

  /** One GET with limiter, timeout, 429 backoff and 5xx retry. Returns body + headers. */
  async request(url: string): Promise<{ body: unknown; headers: { get(name: string): string | null } }> {
    if (!this.sameOrigin(url)) throw new HomebaseApiError('Refused a Homebase link to another host.', 0, '');
    const path = new URL(url).pathname;
    const maxRate = this.opts.maxRateLimitRetries ?? 5;
    const maxServer = this.opts.maxServerRetries ?? 2;
    let rateTries = 0;
    let serverTries = 0;
    const startedAt = new Date();
    const log = (status: 'success' | 'error' | 'throttled', httpStatus: number | null, errorMessage?: string) => {
      if (!this.opts.organizationId) return;
      void recordIntegrationCall({
        integration: 'homebase', operation: `get_${path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:id')}`,
        direction: 'outbound', status, httpStatus, startedAt, organizationId: this.opts.organizationId,
        errorMessage: errorMessage ?? null, metadata: { rateLimitRetries: rateTries, serverRetries: serverTries },
      });
    };
    for (;;) {
      await this.limiter.acquire(rateLimitKey(path));
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20_000) : null;
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        this.requestCount++;
        res = await this.fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: HOMEBASE_ACCEPT },
          signal: ctrl?.signal,
        });
      } catch (err) {
        if (timer) clearTimeout(timer);
        const aborted = err instanceof Error && err.name === 'AbortError';
        if (serverTries < maxServer) {
          serverTries++;
          await this.clock.sleep(1000 * 2 ** serverTries);
          continue;
        }
        log('error', null, aborted ? 'Homebase did not answer in time.' : 'Could not reach Homebase.');
        throw new HomebaseApiError(aborted ? 'Homebase did not answer in time.' : 'Could not reach Homebase.', 0, path);
      }
      if (timer) clearTimeout(timer);
      if (res.status === 429 && rateTries < maxRate) {
        rateTries++;
        const retryAfter = Number.parseFloat(res.headers.get('Retry-After') || '');
        const wait = Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter * 1000, 120_000) : Math.min(2000 * 2 ** (rateTries - 1), 60_000);
        await this.clock.sleep(wait);
        continue;
      }
      if ([502, 503, 504].includes(res.status) && serverTries < maxServer) {
        serverTries++;
        await this.clock.sleep(1000 * 2 ** serverTries);
        continue;
      }
      if (!res.ok) {
        log(res.status === 429 ? 'throttled' : 'error', res.status, errorText(res.status));
        throw new HomebaseApiError(errorText(res.status), res.status, path);
      }
      log('success', res.status);
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { body, headers: res.headers };
    }
  }

  async get(path: string, query: Query = {}): Promise<unknown> {
    return (await this.request(this.url(path, query))).body;
  }

  /** Every page of a list endpoint: follows Link rel="next"; falls back to Total / Per-Page. */
  async getAll(path: string, query: Query = {}): Promise<PageResult> {
    const perPage = this.opts.perPage ?? 100;
    let url: string | null = this.url(path, { ...query, page: 1, per_page: perPage });
    const items: unknown[] = [];
    let total: number | null = null;
    let per: number | null = null;
    let page = 1;
    let pages = 0;
    const seen = new Set<string>();
    while (url && pages < MAX_PAGES) {
      if (seen.has(url)) break;
      seen.add(url);
      const { body, headers } = await this.request(url);
      pages++;
      const list = unwrapList(body);
      items.push(...list);
      const t = Number.parseInt(headers.get('Total') || '', 10);
      const p = Number.parseInt(headers.get('Per-Page') || '', 10);
      if (Number.isFinite(t)) total = t;
      if (Number.isFinite(p) && p > 0) per = p;
      const next = parseLinkHeader(headers.get('Link')).next;
      if (next) {
        url = this.sameOrigin(next) ? new URL(next, this.base).toString() : null;
      } else if (total !== null && per && page * per < total && list.length > 0) {
        page++;
        url = this.url(path, { ...query, page, per_page: per });
      } else {
        url = null;
      }
    }
    return { items, total, perPage: per, pages };
  }

  // ─── Endpoints (GET only) ──────────────────────────────────────────────────
  // Date-range query names start_date / end_date are GUESSED (not in the docs we have).

  company() {
    return this.get('/company');
  }
  locations() {
    return this.getAll('/locations');
  }
  location(uuid: string) {
    return this.get(`/locations/${encodeURIComponent(uuid)}`);
  }
  plan(uuid: string) {
    return this.get(`/locations/${encodeURIComponent(uuid)}/plan`);
  }
  employees(uuid: string) {
    return this.getAll(`/locations/${encodeURIComponent(uuid)}/employees`, { with_archived: true /* GUESSED param */ });
  }
  employee(uuid: string, id: string) {
    return this.get(`/locations/${encodeURIComponent(uuid)}/employees/${encodeURIComponent(id)}`);
  }
  shifts(uuid: string, range: { startDate: string; endDate: string }) {
    return this.getAll(`/locations/${encodeURIComponent(uuid)}/shifts`, { start_date: range.startDate, end_date: range.endDate });
  }
  deletedShifts(uuid: string, range: { startDate: string; endDate: string }) {
    return this.getAll(`/locations/${encodeURIComponent(uuid)}/shifts/deleted`, { start_date: range.startDate, end_date: range.endDate });
  }
  timecards(uuid: string, range: { startDate: string; endDate: string }) {
    return this.getAll(`/locations/${encodeURIComponent(uuid)}/timecards`, { start_date: range.startDate, end_date: range.endDate });
  }
  deletedTimecards(uuid: string, range: { startDate: string; endDate: string }) {
    return this.getAll(`/locations/${encodeURIComponent(uuid)}/timecards/deleted`, { start_date: range.startDate, end_date: range.endDate });
  }
  timeclockStatus() {
    return this.get('/timeclock/status');
  }
}

/**
 * Client for an organization from env. Throws HomebaseNotConnectedError when there is no key (or
 * the key belongs to another practice): never falls back to demo data.
 */
export function homebaseClientFor(organizationId: string, extra: Partial<HomebaseClientOptions> = {}): HomebaseClient {
  const cfg = getHomebaseConfig(organizationId);
  if (!cfg.connected || !cfg.apiKey) throw new HomebaseNotConnectedError(cfg.reason);
  return new HomebaseClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeoutMs: cfg.timeoutMs, organizationId, ...extra });
}
