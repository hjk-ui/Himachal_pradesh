/**
 * Automatic overnight eligibility checks, run on the server by cron (not over HTTP):
 *   npx tsx --conditions=react-server --env-file=.env scripts/eligibility-nightly.ts            (dry run)
 *   npx tsx --conditions=react-server --env-file=.env scripts/eligibility-nightly.ts --apply    (send)
 * Options: DEFAULT_ORG=<id> to limit to one organization.
 *
 * For each organization with the practice setting "Automatic overnight eligibility checks" ON
 * (default OFF), finds tomorrow's appointments whose payer coverage was not verified within the
 * front-office window (30 days; Maryland Medicaid in the visit month) and sends 270 inquiries through
 * the existing Waystar path (requestWaystarEligibility): never for self-pay, one per client + payer per
 * night, at most 99 per 270 file and 300 per organization per night. Refuses to send while the Waystar
 * usage indicator is T unless "Allow on test clearinghouse" is on. Each run is audited
 * (eligibility_nightly_run; every 270 file also writes eligibility_270_sent).
 * Rules: src/lib/eligibility/nightly.ts; database side: src/lib/eligibility/nightlyRun.ts.
 * DRY RUN unless --apply. Prints counts only (no PHI). Holds
 * pg_try_advisory_lock(hashtext('job:eligibility-nightly')); exits 0 with "already running" when
 * another run holds it.
 */
import { prisma } from '@/lib/db/prisma';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';
import { runNightlyEligibility } from '@/lib/eligibility/nightlyRun';

const apply = process.argv.includes('--apply');

async function runAll() {
  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({ where: only ? { id: only } : { active: true }, select: { id: true } });
  for (const org of orgs) {
    const started = Date.now();
    try {
      const c = await runNightlyEligibility({ organizationId: org.id, apply });
      console.log(JSON.stringify({ at: new Date().toISOString(), job: 'eligibility-nightly', ...c, durationMs: Date.now() - started }));
    } catch (err) {
      console.error(`${new Date().toISOString()} eligibility-nightly org=${org.id} failed: ${err instanceof Error ? err.message : 'error'}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  const run = await withJobLock(JOB_LOCK_KEYS.eligibilityNightly, runAll);
  if (!run.acquired) console.log(`${new Date().toISOString()} eligibility-nightly already running; skipped.`);
}

main()
  .catch((err) => {
    console.error('eligibility-nightly failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
