/**
 * One-off: attach clinic users that have no organization to the default organization
 * (slug DEFAULT_ORG_SLUG). This used to run on every GET /api/auth/setup (each login page load,
 * unauthenticated); the route is now read-only.
 *
 *   npx tsx --env-file=.env scripts/backfill-default-org.ts           # dry run: counts only
 *   npx tsx --env-file=.env scripts/backfill-default-org.ts --apply   # write
 *
 * Never creates an organization: if the default org does not exist it stops (exit 1), so it cannot
 * leave a phantom org behind. SUPER_ADMIN users are not touched. Prints ids and counts only.
 * Idempotent: a second run finds nothing to update.
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { DEFAULT_ORG_SLUG } from '@/lib/org/ensureOrganization';

async function main() {
  const apply = process.argv.includes('--apply');
  const org = await prisma.organization.findUnique({ where: { slug: DEFAULT_ORG_SLUG }, select: { id: true } });
  if (!org) {
    console.error(`No organization with slug "${DEFAULT_ORG_SLUG}"; nothing changed.`);
    process.exitCode = 1;
    return;
  }

  const where = { organizationId: null, role: { not: 'SUPER_ADMIN' as const } };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  console.log(`default org ${org.id}: ${users.length} user(s) without an organization${users.length ? `: ${users.map((u) => u.id).join(', ')}` : ''}`);
  if (!apply || users.length === 0) {
    if (!apply && users.length) console.log('Dry run. Re-run with --apply to attach them.');
    return;
  }

  const result = await prisma.user.updateMany({
    where: { ...where, id: { in: users.map((u) => u.id) } },
    data: { organizationId: org.id },
  });
  await writeAuditLog({
    action: 'USER_ORG_BACKFILL',
    actorUserId: null,
    actorRole: 'system',
    organizationId: org.id,
    resourceType: 'user',
    resourceId: 'backfill-default-org',
    outcome: 'SUCCESS',
    userAgent: 'script',
    metadata: { updated: result.count, userIds: users.map((u) => u.id) },
  });
  console.log(`updated ${result.count} user(s)`);
}

main()
  .catch((err) => {
    console.error('backfill-default-org error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
