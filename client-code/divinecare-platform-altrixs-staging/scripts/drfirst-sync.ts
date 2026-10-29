/**
 * Scheduled DrFirst download sweep, run on the server by cron (not over HTTP):
 *   npx tsx --env-file=.env scripts/drfirst-sync.ts
 * Same work as the cron path of POST /api/drfirst/sync: every active organization (or DEFAULT_ORG),
 * per-org cursors, one DRFIRST_SYNC_ORG audit row per organization. Prints ids and counts only.
 * Holds pg_try_advisory_lock(hashtext('job:drfirst-sync')) (same key as the org-level
 * POST /api/drfirst/sync); exits 0 with "already running" when another run holds it.
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { syncOrganization, totals } from '@/app/api/drfirst/_lib/sync';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';
import { purgeRcopiaLogs } from '@/lib/drfirst/persistence';

async function main() {
  if (DEMO_MODE) {
    console.log('DrFirst is not configured; nothing was synced.');
    return;
  }
  const run = await withJobLock(JOB_LOCK_KEYS.drfirstSync, sweep);
  if (!run.acquired) console.log(`${new Date().toISOString()} drfirst-sync already running; skipped.`);
}

async function sweep() {
  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({
    where: only ? { id: only } : { active: true },
    select: { id: true },
  });
  // DrFirst call / SSO log retention (DRFIRST_LOG_RETENTION_DAYS, default 90)
  const purged = await purgeRcopiaLogs().catch(() => 0);
  if (purged) console.log(`${new Date().toISOString()} drfirst log: purged ${purged} rows past retention`);
  for (const org of orgs) {
    const steps = await syncOrganization(org.id);
    const ok = Object.values(steps).every((s) => s.ok);
    await writeAuditLog({
      action: 'DRFIRST_SYNC_ORG',
      actorUserId: null,
      actorRole: 'system',
      organizationId: org.id,
      resourceType: 'prescription',
      resourceId: 'drfirst-sync-cron',
      outcome: ok ? 'SUCCESS' : 'FAILURE',
      ipAddress: null,
      userAgent: 'cron',
      metadata: { scope: 'organization', trigger: 'cron', ...totals(steps) },
    });
    const failed = Object.entries(steps)
      .filter(([, s]) => !s.ok)
      .map(([k, s]) => `${k}: ${s.error ?? 'failed'}`);
    console.log(
      `${new Date().toISOString()} org=${org.id} ${ok ? 'ok' : 'FAILED'} ${JSON.stringify(totals(steps))}${failed.length ? ` | ${failed.join('; ')}` : ''}`
    );
  }
}

main()
  .catch((err) => {
    console.error(`${new Date().toISOString()} drfirst-sync error:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
