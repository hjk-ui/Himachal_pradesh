/**
 * Small in-process caches for heavy read endpoints (inbox, role home, scanners, DrFirst badge).
 *
 * - Values live only in this server process's memory (never sent to a browser cache or CDN).
 * - Keys MUST include organizationId + userId + role (see scopedKey) so one viewer's rows,
 *   which are already filtered by caseload / Part 2 access, are never served to another viewer.
 * - Concurrent callers for the same key share one in-flight computation (summary + items on
 *   the inbox page load compute once).
 * - Failed computations are not cached.
 */

type Entry<T> = { value: T; expiresAt: number; storedAt: number };

export type CacheScope = { organizationId: string; userId: string; role: string };

/** org|user|role|...parts — the only way keys are built, so every entry is per-viewer */
export function scopedKey(scope: CacheScope, ...parts: (string | number | null | undefined)[]): string {
  if (!scope.organizationId || !scope.userId || !scope.role) {
    throw new Error('cache key needs organizationId, userId and role');
  }
  return [scope.organizationId, scope.userId, String(scope.role).toUpperCase(), ...parts.map((p) => (p == null ? '' : String(p)))]
    .map((s) => s.replace(/\|/g, '%7C'))
    .join('|');
}

export class TtlCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly clock: () => number = Date.now
  ) {}

  get(key: string): T | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  /** Fresh or stale entry plus its age (for stale-while-revalidate callers) */
  peek(key: string): { value: T; ageMs: number; fresh: boolean } | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    const now = this.clock();
    return { value: e.value, ageMs: now - e.storedAt, fresh: e.expiresAt > now };
  }

  set(key: string, value: T, ttlMs = this.ttlMs): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      // Drop the oldest insertion (Map keeps insertion order)
      const first = this.entries.keys().next();
      if (!first.done) this.entries.delete(first.value);
    }
    const now = this.clock();
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + ttlMs, storedAt: now });
  }

  /** Cached value, or compute once (concurrent callers share the same promise) */
  async getOrCompute(
    key: string,
    compute: () => Promise<T>,
    opts: { fresh?: boolean; shouldCache?: (value: T) => boolean } = {}
  ): Promise<T> {
    if (!opts.fresh) {
      const hit = this.get(key);
      if (hit !== undefined) return hit;
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const p = (async () => {
      try {
        const value = await compute();
        if (!opts.shouldCache || opts.shouldCache(value)) this.set(key, value);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, p);
    return p;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Remove every entry whose key starts with `prefix` (e.g. one organization after a write) */
  deletePrefix(prefix: string): void {
    for (const k of [...this.entries.keys()]) if (k.startsWith(prefix)) this.entries.delete(k);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Rejects with TimeoutError after `ms`; the underlying work keeps running (and may still fill a cache) */
export function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Server-Timing header builder: `const t = serverTiming(); await t.time('db', fn); headers: t.header()`.
 * Names only, no PHI.
 */
export function serverTiming() {
  const start = performance.now();
  const marks: { name: string; dur: number; desc?: string }[] = [];
  return {
    async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const t0 = performance.now();
      try {
        return await fn();
      } finally {
        marks.push({ name, dur: performance.now() - t0 });
      }
    },
    record(name: string, durMs: number, desc?: string) {
      marks.push({ name, dur: durMs, desc });
    },
    mark(name: string, desc?: string) {
      marks.push({ name, dur: 0, desc });
    },
    header(): string {
      const all = [...marks, { name: 'total', dur: performance.now() - start }];
      return all
        .map((m) => `${m.name.replace(/[^A-Za-z0-9_-]/g, '_')};dur=${m.dur.toFixed(1)}${m.desc ? `;desc="${m.desc.replace(/["\\]/g, '')}"` : ''}`)
        .join(', ');
    },
  };
}

/**
 * Per-viewer caches whose contents depend on who is on whose caseload (role home, inbox sections,
 * session-frequency rollups). Registered by their modules; a write that changes assignment or the
 * treatment team calls invalidateCaseloadScopedCaches so the new clinician sees the client on the
 * next request instead of after the TTL. (The chart and per-client gates are never cached.)
 */
const caseloadScopedCaches = new Set<{ deletePrefix(prefix: string): void }>();

export function registerCaseloadScopedCache<T>(cache: TtlCache<T>): TtlCache<T> {
  caseloadScopedCaches.add(cache);
  return cache;
}

/** Drop every registered caseload-scoped entry of one organization (keys start with org|). */
export function invalidateCaseloadScopedCaches(organizationId: string | null | undefined): void {
  if (!organizationId) return;
  const prefix = `${organizationId.replace(/\|/g, '%7C')}|`;
  for (const c of caseloadScopedCaches) c.deletePrefix(prefix);
}
