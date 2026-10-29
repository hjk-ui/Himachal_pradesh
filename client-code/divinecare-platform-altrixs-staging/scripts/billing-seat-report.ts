/**
 * Seat report (READ-ONLY): active users by seat type and role, active locations, and the proposed
 * list-price quote for each organization. Writes nothing; prints no names or emails.
 *
 *   npx tsx scripts/billing-seat-report.ts                      # all orgs
 *   SEED_ORG_SLUG=<slug> npx tsx scripts/billing-seat-report.ts # one org
 *
 * Use it to replace the assumed MD Behavioral Health staff mix in docs/pricing-model.md.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { countSeats, seatTypeForUser } from '../src/lib/billing/seats';
import { formatUsd, quote, smallestFittingTier, TIERS } from '../src/lib/billing/plans';

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const orgs = await prisma.organization.findMany({
    where: slug ? { slug } : undefined,
    orderBy: { slug: 'asc' },
    select: { id: true, slug: true },
  });
  for (const org of orgs) {
    const users = await prisma.user.findMany({
      where: { organizationId: org.id, status: 'ACTIVE' },
      select: { role: true, roles: true, status: true },
    });
    const locations = await prisma.location.count({ where: { organizationId: org.id, active: true } });
    const count = countSeats(users);
    const byRole = new Map<string, number>();
    for (const u of users) {
      const key = `${seatTypeForUser(u) ?? 'not counted'}:${u.role}`;
      byRole.set(key, (byRole.get(key) || 0) + 1);
    }
    console.log(`\n${org.slug}`);
    console.log(
      `  prescriber ${count.byType.prescriber} · clinician ${count.byType.clinician} · program staff ${count.byType.paraprofessional} · support (free) ${count.support} · locations ${locations}${count.unmapped ? ` · unmapped roles ${count.unmapped}` : ''}`
    );
    console.log(`  by role: ${[...byRole.entries()].sort().map(([k, v]) => `${k}=${v}`).join(', ')}`);
    for (const tier of ['clinic', smallestFittingTier(count.byType, Math.max(1, locations))] as const) {
      for (const interval of ['month', 'year'] as const) {
        const q = quote({ tier, interval, seats: count.byType, locations: Math.max(1, locations) });
        if (q) console.log(`  ${TIERS[tier].name} ${interval === 'year' ? 'annual' : 'monthly'}: ${formatUsd(q.subscriptionPerMonth)}/month (proposed list price, not billed)`);
      }
    }
  }
  console.log(`\n${orgs.length} org(s). Nothing was written.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
