/**
 * Bedrock request pacing. Pure (no AWS imports).
 *
 * The AWS account's Bedrock quota is per model and per minute (Haiku 4.5 and Sonnet 4.6: 10 requests a
 * minute until an increase is approved). Without pacing, the nightly chart-digest prep and the SUD
 * radar scan sent requests faster than that and most of them were rejected as throttled (Oct 27:
 * 5,707 throttled vs 522 accepted). Each process paces its own calls under BEDROCK_{HAIKU|SONNET}_RPM;
 * a call that is still throttled is retried with backoff by the caller.
 */

export type BedrockModelKey = 'SONNET' | 'HAIKU';

/** Default requests per minute per model and process: under the account quota of 10. */
export const DEFAULT_BEDROCK_RPM = 8;

/** BEDROCK_HAIKU_RPM / BEDROCK_SONNET_RPM (whole number; 0 turns pacing off), else 8 */
export function bedrockRpm(model: BedrockModelKey, env: Record<string, string | undefined> = process.env): number {
  const raw = env[`BEDROCK_${model}_RPM`];
  if (raw === undefined || raw.trim() === '') return DEFAULT_BEDROCK_RPM;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BEDROCK_RPM;
}

const WINDOW_MS = 60_000;

/** Sliding one-minute window: at most `rpm` calls start in any 60 seconds; callers queue in order. */
export class RpmLimiter {
  private starts: number[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly rpm: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  /** Resolves when this call may start; returns how long it waited (ms). */
  acquire(): Promise<number> {
    if (this.rpm <= 0) return Promise.resolve(0);
    const turn = this.chain.then(() => this.take());
    this.chain = turn.catch(() => undefined);
    return turn;
  }

  private async take(): Promise<number> {
    const began = this.now();
    for (;;) {
      const t = this.now();
      this.starts = this.starts.filter((s) => t - s < WINDOW_MS);
      if (this.starts.length < this.rpm) {
        this.starts.push(t);
        return t - began;
      }
      await this.sleep(this.starts[0] + WINDOW_MS - t + 5);
    }
  }
}

const limiters = new Map<BedrockModelKey, RpmLimiter>();

/** The process-wide limiter for a model (created on first use from the env setting). */
export function bedrockLimiter(model: BedrockModelKey): RpmLimiter {
  let l = limiters.get(model);
  if (!l) {
    l = new RpmLimiter(bedrockRpm(model));
    limiters.set(model, l);
  }
  return l;
}

/** BEDROCK_THROTTLE_RETRIES (0..6), else 3 */
export function bedrockThrottleRetries(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(String(env.BEDROCK_THROTTLE_RETRIES ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(6, n) : 3;
}
