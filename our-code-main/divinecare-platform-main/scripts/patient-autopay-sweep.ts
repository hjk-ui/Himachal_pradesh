/**
 * Patient Autopay sweep job
 *
 * Selects due autopay enrollments and records idempotent charge drafts/attempts.
 * Live Stripe keys are refused unless PATIENT_PAYMENTS_LIVE_APPROVED=true.
 *
 * Usage:
 *   npx tsx scripts/patient-autopay-sweep.ts
 *   npx tsx scripts/patient-autopay-sweep.ts --dry-run
 *   npx tsx scripts/patient-autopay-sweep.ts --org <organizationId>
 *
 * Scheduling (ops enables later):
 *   - Windows Task Scheduler: daily `npx tsx scripts/patient-autopay-sweep.ts`
 *   - cron: `0 6 * * * cd /app && npx tsx scripts/patient-autopay-sweep.ts`
 *   - GitHub Action: scheduled workflow calling this script with secrets
 *   - ECS scheduled task: same command with env from task definition
 *
 * See docs/PATIENT-AUTOPAY-SWEEP.md
 */

import { runPatientAutopaySweep } from '../src/lib/billing/patient-autopay-sweep';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const orgIdx = args.indexOf('--org');
  const organizationId = orgIdx >= 0 ? args[orgIdx + 1] : undefined;

  const result = await runPatientAutopaySweep({
    organizationId,
    dryRun,
  });

  if (!result.ok) {
    console.error('[patient-autopay-sweep] REFUSED:', result.error);
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: result.mode,
        processed: result.processed,
        created: result.created,
        skipped: result.skipped,
        failed: result.failed,
        dryRun,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[patient-autopay-sweep] fatal', err);
  process.exitCode = 1;
});
