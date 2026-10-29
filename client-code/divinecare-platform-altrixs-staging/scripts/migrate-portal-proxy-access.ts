/**
 * Portal proxy access backfill (after prisma/migrations/20261021_portal_proxy_access.sql).
 *
 *   npx tsx --env-file=.env scripts/migrate-portal-proxy-access.ts            dry run (default)
 *   npx tsx --env-file=.env scripts/migrate-portal-proxy-access.ts --apply    write
 *
 * For every existing PatientAccount with a clientId (a client's own login) creates the explicit
 * PortalAccess 'self' link (verified, full) and fills displayName from the chart when empty.
 * Idempotent: an account that already has a link to its own chart is skipped, so re-runs write nothing.
 * Nothing breaks without it (the session treats an account's own chart as an implicit self link);
 * the explicit rows make the chart card, reports and revocation of a self login consistent.
 *
 * Also REPORTS (never changes) likely guardian logins: a client under 18 whose own login email equals
 * the chart's guardianEmail, or two charts' guardianEmail equal to one login email. Staff convert
 * those on the chart ("Convert to guardian login") after checking authority.
 * Prints ids and counts only (no names, emails or other PHI).
 */
import { prisma } from '@/lib/db/prisma';
import { ageInYears } from '@/patient/domain/proxy-policy';

async function main() {
  const apply = process.argv.includes('--apply');
  const now = new Date();
  const accounts = await prisma.patientAccount.findMany({
    where: { clientId: { not: null } },
    select: {
      id: true, clientId: true, email: true, displayName: true,
      client: { select: { id: true, name: true, organizationId: true, dateOfBirth: true, guardianEmail: true, location: { select: { organizationId: true } } } },
    },
  });
  const existing = await prisma.portalAccess.findMany({ where: { portalUserId: { in: accounts.map((a) => a.id) } }, select: { portalUserId: true, clientId: true } });
  const has = new Set(existing.map((e) => `${e.portalUserId}:${e.clientId}`));

  let created = 0, skipped = 0, named = 0;
  const reviewSelfAsGuardian: string[] = [];
  for (const a of accounts) {
    if (!a.clientId || !a.client) continue;
    const age = ageInYears(a.client.dateOfBirth, now);
    if (age !== null && age < 18 && a.client.guardianEmail && a.client.guardianEmail.trim().toLowerCase() === a.email.toLowerCase()) {
      reviewSelfAsGuardian.push(a.client.id);
    }
    if (has.has(`${a.id}:${a.clientId}`)) {
      skipped++;
      continue;
    }
    created++;
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      await tx.portalAccess.upsert({
        where: { portalUserId_clientId: { portalUserId: a.id, clientId: a.clientId! } },
        create: {
          portalUserId: a.id,
          clientId: a.clientId!,
          organizationId: a.client!.organizationId ?? a.client!.location?.organizationId ?? null,
          relationship: 'self',
          accessLevel: 'full',
          grantedAt: now,
          verifiedAt: now,
          verificationMethod: null,
          verificationNote: 'Backfill: existing portal login of the client (20261021_portal_proxy_access)',
        },
        update: {},
      });
      if (!a.displayName) {
        await tx.patientAccount.update({ where: { id: a.id }, data: { displayName: a.client!.name } });
        named++;
      }
    });
  }

  // Guardian emails shared by several minors' charts (siblings) — candidates for one guardian login
  const minors = await prisma.client.findMany({
    where: { guardianEmail: { not: null }, active: true },
    select: { id: true, guardianEmail: true, dateOfBirth: true },
  });
  const byEmail = new Map<string, string[]>();
  for (const c of minors) {
    const age = ageInYears(c.dateOfBirth, now);
    if (age === null || age >= 18) continue;
    const key = c.guardianEmail!.trim().toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), c.id]);
  }
  const siblingGroups = [...byEmail.values()].filter((ids) => ids.length > 1);

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    accountsWithOwnChart: accounts.length,
    selfLinksToCreate: apply ? undefined : created,
    selfLinksCreated: apply ? created : 0,
    alreadyLinked: skipped,
    displayNamesFilled: named,
    review: {
      minorsWhoseOwnLoginIsTheGuardianEmail: reviewSelfAsGuardian,
      siblingGroupsSharingAGuardianEmail: siblingGroups,
    },
  }, null, 2));
  if (!apply) console.log('Dry run: nothing written. Re-run with --apply to create the self links.');
}

main()
  .catch((err) => {
    console.error('migrate-portal-proxy-access failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().catch(() => undefined));
