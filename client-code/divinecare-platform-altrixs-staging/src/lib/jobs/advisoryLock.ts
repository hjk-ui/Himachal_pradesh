/**
 * Cross-process job lock on a Postgres session advisory lock:
 *   pg_try_advisory_lock(hashtext('job:<name>'))
 *
 * Cron scripts (scripts/drfirst-sync.ts, scripts/sud-radar-scan.ts) and the matching manual API
 * routes use the same key, so a manual run and a cron run (or two servers) never overlap.
 *
 * A session lock must be released on the connection that took it, and the shared Prisma client is
 * a pool, so the lock lives on its own single-connection client. A heartbeat keeps that connection
 * from being reaped as idle during a long job. If the process dies the connection closes and
 * Postgres drops the lock by itself.
 */
import { PrismaClient } from '@prisma/client';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';

export const JOB_LOCK_KEYS = {
  drfirstSync: 'job:drfirst-sync',
  sudRadarScan: 'job:sud-radar-scan',
  /** Suffixed with the organization id: one Clinical Insights scan per organization at a time */
  clinicalInsightsScan: 'job:clinical-insights-scan',
  /** Nightly patient AutoPay catch-up (scripts/patient-autopay-sweep.ts) */
  patientAutopaySweep: 'job:patient-autopay-sweep',
  /** Nightly consent reminders (scripts/consent-reminders.ts) */
  consentReminders: 'job:consent-reminders',
  /** Automatic overnight eligibility checks (scripts/eligibility-nightly.ts) */
  eligibilityNightly: 'job:eligibility-nightly',
  /** Pre-visit measures to patients: rules + sends 3 days / 1 day before visits (scripts/measures-send.ts) */
  measuresSend: 'job:measures-send',
  /** Nightly chart-history digest prep for tomorrow's visits (scripts/chart-digest-prep.ts) */
  chartDigestPrep: 'job:chart-digest-prep',
} as const;

export type JobLockResult<T> = { acquired: true; result: T } | { acquired: false };

const HEARTBEAT_MS = 60_000;

function singleConnectionUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.searchParams.set('connection_limit', '1');
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Runs fn while holding the advisory lock `key`. Returns { acquired: false } without running fn
 * when another session holds it. The lock is released in finally, whatever fn does.
 */
/** Integration log operation for a lock key: "job:clinical-insights-scan:<orgId>" -> "clinical-insights-scan" */
export function jobOperationName(key: string): string {
  return key.replace(/^job:/, '').split(':')[0] || 'job';
}

export async function withJobLock<T>(key: string, fn: () => Promise<T>): Promise<JobLockResult<T>> {
  // Integration log (Admin > Integrations > Logs, integration "cron"): one row per run or skip
  const startedAt = new Date();
  const orgSuffix = key.split(':')[2] || null;
  const logRun = (status: 'success' | 'error' | 'skipped', err?: unknown) =>
    recordIntegrationCall({
      integration: 'cron', operation: jobOperationName(key), direction: 'job', status, startedAt,
      organizationId: orgSuffix, vendorStatus: status === 'skipped' ? 'already_running' : null,
      errorMessage: err ?? null,
    });
  try {
    const out = await withJobLockInner(key, fn);
    if (out.acquired === false) await logRun('skipped');
    else await logRun('success');
    return out;
  } catch (err) {
    await logRun('error', err);
    throw err;
  }
}

async function withJobLockInner<T>(key: string, fn: () => Promise<T>): Promise<JobLockResult<T>> {
  const lockDb = new PrismaClient({ datasourceUrl: singleConnectionUrl(), log: ['error'] });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const rows = await lockDb.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${key})) AS locked`;
    if (!rows[0]?.locked) return { acquired: false };
    heartbeat = setInterval(() => {
      lockDb.$queryRaw`SELECT 1`.catch(() => undefined);
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      return { acquired: true, result: await fn() };
    } finally {
      clearInterval(heartbeat);
      heartbeat = undefined;
      await lockDb.$queryRaw`SELECT pg_advisory_unlock(hashtext(${key}))`.catch(() => undefined);
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await lockDb.$disconnect().catch(() => undefined);
  }
}
