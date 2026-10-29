/**
 * Nightly patient AutoPay catch-up, run on the server by cron (not over HTTP):
 *   npx tsx --conditions=react-server --env-file=.env scripts/patient-autopay-sweep.ts            (dry run)
 *   npx tsx --conditions=react-server --env-file=.env scripts/patient-autopay-sweep.ts --apply    (charge)
 * Options: --days=14 (1-60), DEFAULT_ORG=<id> to limit to one organization.
 *
 * Finds completed / no-show / late-cancel visits and posted ERAs from the last N days that have no
 * PatientCharge row (clients with active AutoPay and a saved card only) and runs them through the same
 * rules as the live triggers (src/lib/patientPayments/sweep.ts). DRY RUN unless --apply. Organizations
 * with patient payments turned off are skipped. Prints counts only (no PHI). Holds
 * pg_try_advisory_lock(hashtext('job:patient-autopay-sweep')); exits 0 with "already running" when
 * another run holds it.
 */
import { prisma } from '@/lib/db/prisma';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';
import { patientPaymentsDeps, prismaSweepFinder } from '@/lib/patientPayments/server';
import { SWEEP_DEFAULT_DAYS, sweepPatientAutopay } from '@/lib/patientPayments/sweep';

const apply = process.argv.includes('--apply');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const days = daysArg ? Number(daysArg.slice('--days='.length)) || SWEEP_DEFAULT_DAYS : SWEEP_DEFAULT_DAYS;

async function sweepAll() {
  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({ where: only ? { id: only } : { active: true }, select: { id: true } });
  const deps = patientPaymentsDeps();
  for (const org of orgs) {
    const started = Date.now();
    try {
      const c = await sweepPatientAutopay(deps, prismaSweepFinder, { organizationId: org.id, apply, days });
      console.log(JSON.stringify({ at: new Date().toISOString(), job: 'patient-autopay-sweep', mode: apply ? 'apply' : 'dry-run', days, ...c, durationMs: Date.now() - started }));
    } catch (err) {
      console.error(`${new Date().toISOString()} patient-autopay-sweep org=${org.id} failed: ${err instanceof Error ? err.message : 'error'}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  const run = await withJobLock(JOB_LOCK_KEYS.patientAutopaySweep, sweepAll);
  if (!run.acquired) console.log(`${new Date().toISOString()} patient-autopay-sweep already running; skipped.`);
}

main()
  .catch((err) => {
    console.error('patient-autopay-sweep failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
