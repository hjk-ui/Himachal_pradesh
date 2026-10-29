/**
 * Nightly portal proxy expiry, run on the server by cron (not over HTTP):
 *   npx tsx --conditions=react-server --env-file=.env scripts/portal-proxy-expiry.ts
 * Ends guardian / representative links whose client turned 18 (links granted while the client was a
 * minor, and every 'parent' link) or whose end date passed, then invites each client who turned 18
 * to their own portal login (when the chart email is not already a portal login).
 * The same check runs on every portal request, so a missed run never extends access.
 * Idempotent (an ended link is never ended twice). Prints counts and client ids only (no PHI).
 */
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { runProxyExpiry } from '@/patient/application/proxy/expiry';

async function main() {
  const now = new Date();
  const r = await runProxyExpiry(now);
  await writeAuditLog({
    action: 'PORTAL_PROXY_EXPIRY',
    actorUserId: null,
    actorRole: 'system',
    resourceType: 'portalAccess',
    resourceId: 'portal-proxy-expiry-cron',
    outcome: 'SUCCESS',
    ipAddress: null,
    userAgent: 'cron',
    metadata: {
      scanned: r.scanned,
      agedOut: r.agedOut,
      expired: r.expired,
      ownInvitesSent: r.ownInvitesSent,
      needsOwnEmail: r.needsOwnEmail.length,
      inviteErrors: r.inviteErrors,
    },
  });
  console.log(`${now.toISOString()} portal-proxy-expiry ${JSON.stringify({ ...r, needsOwnEmail: r.needsOwnEmail })}`);
}

main()
  .catch((err) => {
    console.error(`${new Date().toISOString()} portal-proxy-expiry error:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import('@/lib/db/prisma');
    await prisma.$disconnect().catch(() => undefined);
  });
