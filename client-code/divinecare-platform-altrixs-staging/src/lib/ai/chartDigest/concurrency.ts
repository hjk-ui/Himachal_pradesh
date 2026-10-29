/**
 * Bounded concurrency + Bedrock throttling backoff for the chart digest. Pure (no AWS imports).
 *
 * - mapLimit: runs fn over items with at most `limit` in flight; results keep the input order
 *   (the digest merge is chronological, so chunk order must never depend on finish order).
 * - withThrottleRetry: retries throttling / transient errors (ThrottlingException, 429, 503,
 *   TooManyRequests, ServiceUnavailable, ModelNotReady) with exponential backoff + jitter.
 */

export const DEFAULT_CHUNK_CONCURRENCY = 4;
export const MAX_CHUNK_CONCURRENCY = 16;

/** CHART_DIGEST_CONCURRENCY env override (1..16), else 4 */
export function chunkConcurrency(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(String(env.CHART_DIGEST_CONCURRENCY ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_CHUNK_CONCURRENCY, n) : DEFAULT_CHUNK_CONCURRENCY;
}

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length || 1));
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}

const THROTTLE_NAMES = /throttl|toomanyrequests|serviceunavailable|modelnotready|servicequota|internalserver|timeout/i;

/** True for errors worth retrying (Bedrock throttling / transient service errors) */
export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown; $metadata?: { httpStatusCode?: number }; statusCode?: number; $retryable?: unknown };
  const status = e.$metadata?.httpStatusCode ?? e.statusCode;
  if (status === 429 || status === 503 || status === 500) return true;
  if (e.$retryable) return true;
  return THROTTLE_NAMES.test(String(e.name ?? '')) || THROTTLE_NAMES.test(String(e.code ?? ''));
}

export type RetryOptions = {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** called before each retry (counts only) */
  onRetry?: (attempt: number, err: unknown) => void;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withThrottleRetry<T>(fn: () => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const retries = o.retries ?? 4;
  const base = o.baseMs ?? 1000;
  const max = o.maxMs ?? 20_000;
  const sleep = o.sleep ?? realSleep;
  const random = o.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryableError(err)) throw err;
      o.onRetry?.(attempt + 1, err);
      const delay = Math.min(max, base * 2 ** attempt);
      await sleep(Math.round(delay / 2 + random() * (delay / 2)));
    }
  }
}
