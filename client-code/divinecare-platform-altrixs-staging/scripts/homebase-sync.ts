/**
 * Homebase read-only sync, for cron (not over HTTP):
 *   npx tsx --conditions=react-server --env-file=.env scripts/homebase-sync.ts
 * Options: --start=YYYY-MM-DD --end=YYYY-MM-DD (default: last 31 days through 14 days ahead).
 *
 * Syncs the one organization the Homebase key is bound to (HOMEBASE_ORGANIZATION_ID). Without
 * HOMEBASE_API_KEY it prints "not connected" and exits 0: it never invents data. Pulls locations,
 * employees, shifts and timecards (and the /deleted lists); nothing is ever sent to Homebase.
 * Prints counts only. Holds pg_try_advisory_lock(hashtext('job:homebase-sync:<org>')), shared with
 * HR > Homebase > Sync now; exits 0 with "already running" when another run holds it.
 *
 * Crontab line (deploy/crontab.staging) is COMMENTED OUT: install only after owner approval.
 */
import { prisma } from '@/lib/db/prisma';
import { withJobLock } from '@/lib/jobs/advisoryLock';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { getHomebaseConfig, HOMEBASE_REASON_TEXT } from '@/lib/hr/homebase/config';
import { syncNow } from '@/lib/hr/homebase/data';
import { HOMEBASE_SYNC_LOCK_KEY } from '@/lib/hr/homebase/sync';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const cfg = getHomebaseConfig();
  if (!cfg.apiKey || !cfg.organizationId) {
    console.log(`${new Date().toISOString()} homebase-sync: ${HOMEBASE_REASON_TEXT[cfg.reason]} Skipped.`);
    return;
  }
  const organizationId = cfg.organizationId;
  const start = arg('start');
  const end = arg('end');
  const range = start && end ? { startDate: start, endDate: end } : undefined;
  const started = Date.now();
  const run = await withJobLock(`${HOMEBASE_SYNC_LOCK_KEY}:${organizationId}`, () => syncNow(organizationId, null, 'cron', range));
  if (!run.acquired) {
    console.log(`${new Date().toISOString()} homebase-sync already running; skipped.`);
    return;
  }
  const out = run.result;
  if (out.ok === false) {
    console.error(`${new Date().toISOString()} homebase-sync refused: ${out.error}`);
    process.exitCode = 1;
    return;
  }
  await writeAuditLog({
    action: 'HR_HOMEBASE_SYNC',
    actorUserId: null,
    actorRole: 'SYSTEM',
    organizationId,
    resourceType: 'HomebaseSyncRun',
    resourceId: out.result.runId,
    outcome: out.result.status === 'failed' ? 'FAILURE' : 'SUCCESS',
    metadata: { area: 'hr', trigger: 'cron', status: out.result.status, rangeStart: out.range.startDate, rangeEnd: out.range.endDate, ...out.result.counts },
  });
  console.log(JSON.stringify({ at: new Date().toISOString(), job: 'homebase-sync', status: out.result.status, ...out.result.counts, error: out.result.error, durationMs: Date.now() - started }));
  if (out.result.status === 'failed') process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('homebase-sync failed:', err instanceof Error ? err.message : 'error');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
