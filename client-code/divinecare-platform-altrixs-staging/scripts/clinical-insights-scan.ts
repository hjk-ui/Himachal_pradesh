/**
 * Nightly Clinical Insights scan, run on the server by cron (not over HTTP):
 *   npx tsx --conditions=react-server --env-file=.env scripts/clinical-insights-scan.ts
 * Rebuilds the Clinical Insights snapshot for every active organization (or DEFAULT_ORG), the whole
 * org, under the per-org Postgres advisory lock job:clinical-insights-scan:<org> (the page's Refresh
 * uses the same lock; a running scan is skipped, not duplicated). One CLINICAL_INSIGHTS_SCAN_ORG
 * audit row per organization. No AI. Prints ids and counts only (no PHI).
 *
 * Suggested crontab (after the service eligibility scan): 0 3 * * *  cd /app && npx tsx ... >> /var/log/altrixs-insights.log 2>&1
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { InsightsBusyError, runAndStoreInsights } from '@/lib/insights/clinical/snapshot';

async function main() {
  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({ where: only ? { id: only } : { active: true }, select: { id: true } });
  for (const org of orgs) {
    const audit = (outcome: 'SUCCESS' | 'FAILURE', metadata: Record<string, unknown>) =>
      writeAuditLog({
        action: 'CLINICAL_INSIGHTS_SCAN_ORG', actorUserId: null, actorRole: 'system', organizationId: org.id,
        resourceType: 'clinicalInsightsScan', resourceId: 'clinical-insights-cron', outcome, ipAddress: null, userAgent: 'cron',
        metadata: { scope: 'organization', trigger: 'cron', ...metadata },
      });
    try {
      const stored = await runAndStoreInsights({
        organizationId: org.id,
        clientWhere: clientOrgFilter(org.id),
        // System scan: every client; the page applies each viewer's Part 2 lock on read
        lockedIds: async () => new Set<string>(),
        trigger: 'cron',
        scope: 'organization',
        actor: { userId: null, role: 'ADMIN' },
        timeZone: await getPracticeTimeZone(org.id),
      });
      const summary = { runId: stored.runId, durationMs: stored.durationMs, clientsScanned: stored.clientsScanned, truncated: stored.truncated, counts: stored.counts };
      await audit('SUCCESS', { ...summary, counts: JSON.stringify(stored.counts) });
      console.log(`${new Date().toISOString()} org=${org.id} ok ${JSON.stringify(summary)}`);
    } catch (err) {
      if (err instanceof InsightsBusyError) {
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
    console.error(`${new Date().toISOString()} clinical-insights-scan error:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
