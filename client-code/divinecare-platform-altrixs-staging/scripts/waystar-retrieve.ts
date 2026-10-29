/**
 * Scheduled Waystar retrieval, run on the server by cron (not over HTTP):
 *   npx tsx --conditions=react-server --env-file=.env scripts/waystar-retrieve.ts
 *
 * Same work as "Check Waystar responses" on the Claims page, for every organization at once
 * (the Waystar mailbox is shared): list /Download, pull new files to S3 (Waystar moves collected
 * files to /Download/Archive), apply 999 / 277CA / 277 / 835 (ERA auto-post + review queue) / 271.
 * Idempotent: each file is applied once (waystar_inbound_files, per-file lock), each 835 payment
 * once (TRN02 + TRN03). One waystar_retrieval_runs row and one audit row per run, plus one
 * WAYSTAR_RETRIEVAL_ORG audit row per organization that had updates. Prints counts only.
 *
 * Env: WAYSTAR_RETRIEVE_WAIT_MS (default 60000) bounds the wait for newly requested files.
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { runWaystarRetrieval, waystarRetrievalAvailable } from '@/lib/billing/waystarInbound/retrieval';

async function main() {
  if (!waystarRetrievalAvailable()) {
    console.log(`${new Date().toISOString()} Waystar SFTP is not configured (or AWS demo mode); nothing retrieved.`);
    return;
  }
  const waitMs = Number(process.env.WAYSTAR_RETRIEVE_WAIT_MS) || 60_000;
  const out = await runWaystarRetrieval({ trigger: 'cron', actorUserId: null, waitMs });

  const perOrg = new Map<string, { claimUpdates: number; files: number }>();
  for (const u of out.claimUpdates) {
    const o = perOrg.get(u.organizationId) ?? { claimUpdates: 0, files: 0 };
    o.claimUpdates++;
    perOrg.set(u.organizationId, o);
  }
  for (const f of out.files) {
    for (const org of f.organizationIds) {
      const o = perOrg.get(org) ?? { claimUpdates: 0, files: 0 };
      o.files++;
      perOrg.set(org, o);
    }
  }
  for (const [organizationId, counts] of perOrg) {
    await writeAuditLog({
      action: 'WAYSTAR_RETRIEVAL_ORG',
      actorUserId: null,
      actorRole: 'system',
      organizationId,
      resourceType: 'WaystarRetrievalRun',
      resourceId: out.runId,
      userAgent: 'cron',
      metadata: { trigger: 'cron', ...counts },
    });
  }

  const byType: Record<string, number> = {};
  for (const f of out.files) byType[f.type] = (byType[f.type] || 0) + 1;
  console.log(
    `${new Date().toISOString()} run=${out.runId} listed=${out.listedFiles} requested=${out.newlyRequested.length} applied=${out.files.length} ` +
      `types=${JSON.stringify(byType)} claimUpdates=${out.claimUpdates.length} eraPosted=${out.era.posted} eraReview=${out.era.review} ` +
      `eraDuplicates=${out.era.duplicates} eligibility=${out.eligibilityUpdated} waiting=${out.notYetArrived.length}` +
      (out.listingError ? ` | listing: ${out.listingError}` : '') +
      (out.errors.length ? ` | errors: ${out.errors.length}` : '')
  );
  if (out.errors.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`${new Date().toISOString()} waystar-retrieve error:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
