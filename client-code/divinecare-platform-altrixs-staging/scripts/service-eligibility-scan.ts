/**
 * Nightly Service Eligibility scan, run on the server by cron (not over HTTP):
 *   npx tsx --conditions=react-server --env-file=.env scripts/service-eligibility-scan.ts
 * Rebuilds the scanner snapshot for every active organization (or DEFAULT_ORG), the whole org,
 * under the same per-org Postgres advisory lock as the page's Re-scan (a running scan is skipped,
 * not duplicated). One SERVICE_ELIGIBILITY_SCAN_ORG audit row per organization. No AI.
 * Prints ids and counts only (no PHI).
 *
 * Suggested crontab (after the SUD radar scan): 30 2 * * *  cd /app && npx tsx ... >> /var/log/altrixs-scanner.log 2>&1
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { runAndStoreScan, ScanBusyError } from '@/lib/clinical/serviceEligibility/snapshot';

async function main() {
  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({ where: only ? { id: only } : { active: true }, select: { id: true } });
  for (const org of orgs) {
    const audit = (outcome: 'SUCCESS' | 'FAILURE', metadata: Record<string, unknown>) =>
      writeAuditLog({
        action: 'SERVICE_ELIGIBILITY_SCAN_ORG', actorUserId: null, actorRole: 'system', organizationId: org.id,
        resourceType: 'serviceEligibilityScan', resourceId: 'service-eligibility-cron', outcome, ipAddress: null, userAgent: 'cron',
        metadata: { scope: 'organization', trigger: 'cron', ...metadata },
      });
    try {
      const stored = await runAndStoreScan({
        organizationId: org.id,
        clientWhere: clientOrgFilter(org.id),
        // System scan: every active client; the page applies each viewer's Part 2 lock on read
        lockedIds: async () => new Set<string>(),
        trigger: 'cron',
        scope: 'organization',
        actorUserId: null,
        timeZone: await getPracticeTimeZone(org.id),
      });
      const summary = {
        runId: stored.runId,
        durationMs: stored.durationMs,
        clientsScanned: stored.scan.clientsScanned,
        notIndicatedOnly: stored.scan.notIndicatedOnly,
        truncated: stored.scan.truncated,
        counts: stored.scan.counts,
      };
      await audit('SUCCESS', summary);
      console.log(`${new Date().toISOString()} org=${org.id} ok ${JSON.stringify(summary)}`);
    } catch (err) {
      if (err instanceof ScanBusyError) {
        console.log(`${new Date().toISOString()} org=${org.id} skipped: a scan is already running`);
        continue;
      }
      await audit('FAILURE', { reason: 'scan_error' });
      console.error(`${new Date().toISOString()} org=${org.id} FAILED: ${err instanceof Error ? err.message : 'unknown error'}`);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((err) => {
    console.error(`${new Date().toISOString()} service-eligibility-scan error:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
