/**
 * Read-only check that the fast org-wide session-frequency path (SQL aggregates) gives the same
 * result as the row-reading path, and how long each takes:
 *   npx tsx --env-file=.env scripts/check-session-frequency.ts <organizationId> [actorUserId]
 * Runs as PRACTICE_DIRECTOR scope (whole org). Prints counts, timings and mismatching client ids
 * only (no names). Writes nothing.
 */
import { prisma } from '@/lib/db/prisma';
import { loadSessionFrequency } from '@/lib/clinical/sessionFrequencyData';

async function main() {
  const organizationId = process.argv[2];
  if (!organizationId) throw new Error('Usage: check-session-frequency.ts <organizationId> [actorUserId]');
  const actorUserId = process.argv[3] || 'check-script';
  const actor = { organizationId, actorUserId, actorRole: 'PRACTICE_DIRECTOR' as const };
  const now = new Date();

  let t = Date.now();
  const fast = await loadSessionFrequency(actor, { detail: false }, now);
  const fastMs = Date.now() - t;
  t = Date.now();
  const rows = await loadSessionFrequency(actor, { detail: true }, now);
  const rowsMs = Date.now() - t;

  console.log(`aggregate path: ${fastMs} ms, ${fast.items.length} clients`, fast.summary);
  console.log(`row path:       ${rowsMs} ms, ${rows.items.length} clients`, rows.summary);

  const byId = new Map(rows.items.map((i) => [i.clientId, i]));
  const mismatches: string[] = [];
  for (const a of fast.items) {
    const b = byId.get(a.clientId);
    const pick = (i: typeof a) =>
      JSON.stringify([
        i.bucket,
        i.therapy.recommendation.source,
        i.therapy.lastAttended,
        i.therapy.nextScheduled,
        i.therapy.sessionsLast8Weeks,
        i.medManagement.lastAttended,
        i.medManagement.nextScheduled,
      ]);
    if (!b || pick(a) !== pick(b)) mismatches.push(`${a.clientId} fast=${pick(a)} rows=${b ? pick(b) : 'missing'}`);
  }
  console.log(`mismatches: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 50)) console.log('  ' + m);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
