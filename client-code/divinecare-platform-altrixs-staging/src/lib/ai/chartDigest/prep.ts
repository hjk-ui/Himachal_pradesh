/**
 * Nightly chart-history prep (scripts/chart-digest-prep.ts): pure selection + bounded runner.
 *
 * Selects clients with a visit tomorrow (practice time zone; --days=N for N days ahead) across
 * all clinicians, picks the digest kind from the visit (primary-care visit → 'medical', any other
 * → 'bh'), keeps those whose digest is missing or stale, and generates them with bounded
 * concurrency, a per-run budget cap (dollars) and a client cap. Counts and costs only: this module
 * never sees names.
 */
import { addCalendarDays } from '@/lib/workflows/dates';
import { fromPracticeWallTime, toPracticeWallTime } from '@/lib/time/practiceTime';
import { visitKindOf } from '@/lib/ai/previsit/enrich';
import type { DigestKind } from '@/lib/ai/chartDigest/access';

export const PREP_DEFAULTS = { days: 1, concurrency: 4, maxCostUsd: 75, maxClients: 200 } as const;
export const PREP_MAX_CONCURRENCY = 8;

/** tomorrow = the evening run (visits tomorrow, then the huddle notice); today = the morning top-up */
export type PrepDates = 'tomorrow' | 'today';

export type PrepArgs = { days: number; dates: PrepDates; concurrency: number; maxCostUsd: number; maxClients: number; apply: boolean; org: string | null };

export function parsePrepArgs(argv: readonly string[], env: Record<string, string | undefined> = {}): PrepArgs {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const int = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const cost = Number.parseFloat(String(value('max-cost') ?? ''));
  const dates: PrepDates = String(value('dates') ?? '').trim().toLowerCase() === 'today' ? 'today' : 'tomorrow';
  return {
    // The morning top-up covers today only
    days: dates === 'today' ? 1 : int(value('days'), PREP_DEFAULTS.days, 1, 7),
    dates,
    concurrency: int(value('concurrency'), PREP_DEFAULTS.concurrency, 1, PREP_MAX_CONCURRENCY),
    maxCostUsd: Number.isFinite(cost) && cost >= 0 ? cost : PREP_DEFAULTS.maxCostUsd,
    maxClients: int(value('max-clients'), PREP_DEFAULTS.maxClients, 1, 5000),
    apply: argv.includes('--apply'),
    org: value('org') || env.DEFAULT_ORG?.trim() || null,
  };
}

/**
 * Practice-local window: tomorrow 00:00 through the end of the Nth day ahead (evening run), or
 * today 00:00 through tonight (startDays = 0: the morning top-up).
 */
export function prepWindow(now: Date, timeZone: string, days: number, startDays = 1): { from: Date; to: Date; dates: string[] } {
  const today = toPracticeWallTime(now, timeZone).date;
  const dates = Array.from({ length: Math.max(1, days) }, (_, i) => addCalendarDays(today, i + startDays));
  const from = fromPracticeWallTime(dates[0], '00:00', timeZone)!;
  const to = fromPracticeWallTime(addCalendarDays(dates[dates.length - 1], 1), '00:00', timeZone)!;
  return { from, to, dates };
}

export type PrepAppointment = { clientId: string; startsAt: Date; type: string; status: string; notes?: string | null; clinicianRole?: string | null };
export type PrepTarget = { clientId: string; kind: DigestKind; visitAt: Date };

export function digestKindForVisit(a: { type: string; notes?: string | null; clinicianRole?: string | null }): DigestKind {
  return visitKindOf(a) === 'primary_care' ? 'medical' : 'bh';
}

/** One target per client + kind (earliest visit first), inside the window, scheduled visits only */
export function selectPrepTargets(appts: readonly PrepAppointment[], window: { from: Date; to: Date }): PrepTarget[] {
  const out = new Map<string, PrepTarget>();
  for (const a of [...appts].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())) {
    if (!['SCHEDULED', 'CHECKED_IN'].includes(a.status)) continue;
    if (a.startsAt < window.from || a.startsAt >= window.to) continue;
    const kind = digestKindForVisit(a);
    const key = `${a.clientId}:${kind}`;
    if (!out.has(key)) out.set(key, { clientId: a.clientId, kind, visitAt: a.startsAt });
  }
  return [...out.values()];
}

export type DigestFreshness = 'missing' | 'stale' | 'fresh';

/** Keep missing / stale digests only (fresh ones are left alone) */
export async function needingPrep(targets: readonly PrepTarget[], freshness: (t: PrepTarget) => Promise<DigestFreshness>): Promise<Array<PrepTarget & { reason: Exclude<DigestFreshness, 'fresh'> }>> {
  const out: Array<PrepTarget & { reason: Exclude<DigestFreshness, 'fresh'> }> = [];
  for (const t of targets) {
    const f = await freshness(t).catch(() => 'missing' as const);
    if (f !== 'fresh') out.push({ ...t, reason: f });
  }
  return out;
}

export type PrepOutcome = { status: 'generated' | 'up_to_date' | 'not_generated' | 'failed'; costUsd: number; reason?: string };

export type PrepSummary = {
  candidates: number;
  attempted: number;
  generated: number;
  upToDate: number;
  notGenerated: number;
  failed: number;
  /** Not started: the client cap */
  skippedByClientCap: number;
  /** Not started: the budget cap was reached */
  skippedByBudget: number;
  budgetReached: boolean;
  costUsd: number;
  byKind: Record<DigestKind, number>;
  reasons: Record<string, number>;
  maxInFlight: number;
};

/**
 * Bounded runner. A job starts only while spent + (in-flight × estimate) is under the budget, so the
 * cap is never knowingly exceeded; the estimate is the running average cost (or `estimateUsd` before
 * the first job finishes).
 */
export async function runPrep<T extends PrepTarget>(input: {
  targets: readonly T[];
  concurrency: number;
  maxCostUsd: number;
  maxClients: number;
  /** cost guess before any job finished (default $1) */
  estimateUsd?: number;
  generate: (t: T) => Promise<PrepOutcome>;
}): Promise<PrepSummary> {
  const s: PrepSummary = {
    candidates: input.targets.length,
    attempted: 0,
    generated: 0,
    upToDate: 0,
    notGenerated: 0,
    failed: 0,
    skippedByClientCap: 0,
    skippedByBudget: 0,
    budgetReached: false,
    costUsd: 0,
    byKind: { bh: 0, medical: 0 },
    reasons: {},
    maxInFlight: 0,
  };
  const clientIds = new Set<string>();
  const queue: T[] = [];
  for (const t of input.targets) {
    if (!clientIds.has(t.clientId) && clientIds.size >= input.maxClients) {
      s.skippedByClientCap++;
      continue;
    }
    clientIds.add(t.clientId);
    queue.push(t);
  }
  let inFlight = 0;
  let done = 0;
  let next = 0;
  const estimate = () => (done ? s.costUsd / done : input.estimateUsd ?? 1);
  const worker = async () => {
    for (;;) {
      if (next >= queue.length) return;
      if (s.budgetReached || s.costUsd + (inFlight + 1) * estimate() > input.maxCostUsd) {
        s.budgetReached = true;
        return;
      }
      const t = queue[next++];
      inFlight++;
      s.maxInFlight = Math.max(s.maxInFlight, inFlight);
      s.attempted++;
      let r: PrepOutcome;
      try {
        r = await input.generate(t);
      } catch (err) {
        r = { status: 'failed', costUsd: 0, reason: err instanceof Error ? err.name : 'unknown' };
      }
      inFlight--;
      done++;
      s.costUsd += Math.max(0, r.costUsd || 0);
      if (r.status === 'generated') {
        s.generated++;
        s.byKind[t.kind]++;
      } else if (r.status === 'up_to_date') s.upToDate++;
      else if (r.status === 'not_generated') s.notGenerated++;
      else s.failed++;
      if (r.reason) s.reasons[r.reason] = (s.reasons[r.reason] ?? 0) + 1;
      if (s.costUsd >= input.maxCostUsd) s.budgetReached = true;
    }
  };
  const width = Math.max(1, Math.min(input.concurrency, queue.length || 1));
  await Promise.all(Array.from({ length: width }, worker));
  s.skippedByBudget = queue.length - s.attempted;
  s.costUsd = Math.round(s.costUsd * 10_000) / 10_000;
  return s;
}

/** One log line: counts and dollars only (no names, no ids) */
export function formatPrepSummary(s: PrepSummary, extra: Record<string, string | number> = {}): string {
  const reasons = Object.entries(s.reasons).map(([k, v]) => `${k}=${v}`).join(',');
  const parts = [
    ...Object.entries(extra).map(([k, v]) => `${k}=${v}`),
    `candidates=${s.candidates}`,
    `attempted=${s.attempted}`,
    `generated=${s.generated}`,
    `bh=${s.byKind.bh}`,
    `medical=${s.byKind.medical}`,
    `upToDate=${s.upToDate}`,
    `notGenerated=${s.notGenerated}`,
    `failed=${s.failed}`,
    `skippedByClientCap=${s.skippedByClientCap}`,
    `skippedByBudget=${s.skippedByBudget}`,
    `budgetReached=${s.budgetReached}`,
    `cost=$${s.costUsd.toFixed(4)}`,
  ];
  if (reasons) parts.push(`reasons=${reasons}`);
  return parts.join(' ');
}

/** The crontab line (deploy/crontab.staging, commented out until the owner approves) */
export const PREP_CRON_COMMAND = 'scripts/chart-digest-prep.ts --apply';
