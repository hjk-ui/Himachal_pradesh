/**
 * Scheduled SUD Referral Radar scan, run on the server by cron (not over HTTP):
 *   npx tsx --conditions=react-server --env-file=.env scripts/sud-radar-scan.ts
 * Same work as POST /api/ehr/scanner/run-ai-scan for leadership roles: every active organization
 * (or DEFAULT_ORG), the whole org, one SUD_RADAR_SCAN_ORG audit row per organization.
 * Uses Bedrock confirmation only when AWS credentials / AWS_LIVE are configured.
 * Prints ids and counts only (no PHI).
 * Holds pg_try_advisory_lock(hashtext('job:sud-radar-scan')) (same key as
 * POST /api/ehr/scanner/run-ai-scan); exits 0 with "already running" when another run holds it.
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { runSudRadarScan } from '@/lib/clinical/sudRadar/scan';
import { practiceSudRadarAutoAssign } from '@/lib/practice/consumers';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';

async function main() {
  const run = await withJobLock(JOB_LOCK_KEYS.sudRadarScan, scanAll);
  if (!run.acquired) console.log(`${new Date().toISOString()} sud-radar-scan already running; skipped.`);
}

async function scanAll() {
  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({
    where: only ? { id: only } : { active: true },
    select: { id: true },
  });
  for (const org of orgs) {
    const started = Date.now();
    try {
      const counts = await runSudRadarScan({
        organizationId: org.id,
        actor: { userId: null, role: 'system' },
        clientWhere: clientOrgFilter(org.id),
        trigger: 'cron',
        autoAssignMeasures: await practiceSudRadarAutoAssign(org.id),
      });
      const summary = {
        clientsScanned: counts.clientsScanned,
        notesScanned: counts.notesScanned,
        documentsScanned: counts.documentsScanned,
        findings: counts.findings,
        bySource: counts.bySource,
        byConfidence: counts.byConfidence,
        byAction: counts.byAction,
        created: counts.created,
        updated: counts.updated,
        reopened: counts.reopened,
        resolved: counts.resolved,
        aiClientsReviewed: counts.ai.clientsReviewed,
        aiFailed: counts.ai.failed,
        aiSkippedConsent: counts.ai.skippedConsent,
        measuresAssigned: counts.measures.assigned,
        durationMs: Date.now() - started,
      };
      await writeAuditLog({
        action: 'SUD_RADAR_SCAN_ORG',
        actorUserId: null,
        actorRole: 'system',
        organizationId: org.id,
        resourceType: 'sudRadarScan',
        resourceId: 'sud-radar-cron',
        outcome: 'SUCCESS',
        ipAddress: null,
        userAgent: 'cron',
        metadata: { scope: 'organization', trigger: 'cron', ...summary },
      });
      console.log(`${new Date().toISOString()} org=${org.id} ok ${JSON.stringify(summary)}`);
    } catch (err) {
      await writeAuditLog({
        action: 'SUD_RADAR_SCAN_ORG',
        actorUserId: null,
        actorRole: 'system',
        organizationId: org.id,
        resourceType: 'sudRadarScan',
        resourceId: 'sud-radar-cron',
        outcome: 'FAILURE',
        ipAddress: null,
        userAgent: 'cron',
        metadata: { scope: 'organization', trigger: 'cron', reason: 'scan_error' },
      });
      console.error(`${new Date().toISOString()} org=${org.id} FAILED: ${err instanceof Error ? err.message : 'unknown error'}`);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((err) => {
    console.error(`${new Date().toISOString()} sud-radar-scan error:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
