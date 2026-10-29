/**
 * Pre-visit measures to patients, run on the server by cron (not over HTTP):
 *   npx tsx --env-file=.env scripts/measures-send.ts            (dry run)
 *   npx tsx --env-file=.env scripts/measures-send.ts --apply    (assign + send)
 * Options: DEFAULT_ORG=<id> to limit to one organization.
 *
 * Per organization (src/lib/measures/job.ts): the measurement-based care rules leadership turned on
 * add assignments (never twice), then visits 3 days and 1 day out get their due measures by email /
 * text (only with an email on file / SMS consent; Part 2 substance-use measures only when the Part 2
 * consent covers it; messages carry no PHI), then links older than 7 days expire. "Send measures to
 * patients before visits" is OFF by default; with it off nothing is sent. Prints counts only (no
 * PHI). Holds pg_try_advisory_lock(hashtext('job:measures-send')); exits 0 with "already running"
 * when another run holds it.
 */
import { prisma } from '@/lib/db/prisma';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';
import { runMeasureSends } from '@/lib/measures/job';

const apply = process.argv.includes('--apply');

async function runAll() {
  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({ where: only ? { id: only } : { active: true }, select: { id: true } });
  for (const org of orgs) {
    const started = Date.now();
    try {
      const c = await runMeasureSends({ organizationId: org.id, apply });
      console.log(JSON.stringify({ at: new Date().toISOString(), job: 'measures-send', ...c, durationMs: Date.now() - started }));
    } catch (err) {
      console.error(`${new Date().toISOString()} measures-send org=${org.id} failed: ${err instanceof Error ? err.message : 'error'}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  const run = await withJobLock(JOB_LOCK_KEYS.measuresSend, runAll);
  if (!run.acquired) console.log(`${new Date().toISOString()} measures-send already running; skipped.`);
}

main()
  .catch((err) => {
    console.error('measures-send failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
