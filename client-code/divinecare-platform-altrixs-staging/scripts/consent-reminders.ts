/**
 * Nightly automatic consent reminders, run on the server by cron (not over HTTP):
 *   npx tsx --env-file=.env scripts/consent-reminders.ts            (dry run)
 *   npx tsx --env-file=.env scripts/consent-reminders.ts --apply    (send)
 * Options: DEFAULT_ORG=<id> to limit to one organization.
 *
 * Unsigned portal packets get reminders 3 and 7 days after they were sent; required consents get
 * renewal reminders 30 and 7 days before they expire (the renewal forms go to the portal). At most 3
 * reminders per packet / consent, tracked in ConsentReminder so a rerun never double-sends. Portal +
 * email (when on file) + SMS only through the patient SMS gate with consent; messages never name the
 * forms. Organizations with "Automatic consent reminders" off are skipped. Rules:
 * src/lib/consents/library/decisions.ts; job: src/lib/consents/library/reminders.ts.
 * DRY RUN unless --apply. Prints counts only (no PHI). Holds
 * pg_try_advisory_lock(hashtext('job:consent-reminders')); exits 0 with "already running" when
 * another run holds it.
 */
import { prisma } from '@/lib/db/prisma';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';
import { runConsentReminders } from '@/lib/consents/library/reminders';

const apply = process.argv.includes('--apply');

async function remindAll() {
  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({ where: only ? { id: only } : { active: true }, select: { id: true } });
  for (const org of orgs) {
    const started = Date.now();
    try {
      const c = await runConsentReminders({ organizationId: org.id, apply });
      console.log(JSON.stringify({ at: new Date().toISOString(), job: 'consent-reminders', ...c, durationMs: Date.now() - started }));
    } catch (err) {
      console.error(`${new Date().toISOString()} consent-reminders org=${org.id} failed: ${err instanceof Error ? err.message : 'error'}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  const run = await withJobLock(JOB_LOCK_KEYS.consentReminders, remindAll);
  if (!run.acquired) console.log(`${new Date().toISOString()} consent-reminders already running; skipped.`);
}

main()
  .catch((err) => {
    console.error('consent-reminders failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
