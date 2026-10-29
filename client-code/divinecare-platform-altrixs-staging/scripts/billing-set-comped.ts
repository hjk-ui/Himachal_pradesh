/**
 * Mark an organization as complimentary ("comped"): never billed, never read-only, every feature.
 * Used for MD Behavioral Health (launch customer) and internal/demo orgs.
 *
 * Usage:
 *   npx tsx scripts/billing-set-comped.ts <organizationId> "<reason>"          # dry run (prints only)
 *   npx tsx scripts/billing-set-comped.ts <organizationId> "<reason>" --apply  # writes the record
 *   npx tsx scripts/billing-set-comped.ts <organizationId> --remove --apply    # back to grandfathered
 *
 * MD Behavioral Health (cmva1hmq6000090ohpo38undp) is also hard-wired as comped in
 * src/lib/billing/entitlements.ts (LAUNCH_CUSTOMER_ORG_IDS), so it stays comped even without this
 * record. Other orgs can alternatively be listed in BILLING_COMPED_ORG_IDS (comma-separated).
 * Requires DATABASE_URL. Keeps any Stripe ids already on the record.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';
import { SUBSCRIPTION_MODULE, normalizeRecord } from '../src/lib/billing/subscriptionRecord';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const remove = args.includes('--remove');
  const [organizationId, reason] = args.filter((a) => !a.startsWith('--'));
  if (!organizationId || (!remove && !reason)) {
    console.error('Usage: npx tsx scripts/billing-set-comped.ts <organizationId> "<reason>" [--apply] | <organizationId> --remove [--apply]');
    process.exitCode = 1;
    return;
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
  if (!org) {
    console.error(`Organization ${organizationId} not found`);
    process.exitCode = 1;
    return;
  }
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module: SUBSCRIPTION_MODULE } },
  });
  const current = normalizeRecord(row?.data ?? null);
  const next = {
    ...current,
    status: remove ? ('grandfathered' as const) : ('comped' as const),
    compedReason: remove ? null : reason,
    updatedAt: new Date().toISOString(),
  };
  console.log(`${org.name} (${org.id})`);
  console.log(`  current: status=${current.status} tier=${current.tier ?? '-'}`);
  console.log(`  next:    status=${next.status}${next.compedReason ? ` reason="${next.compedReason}"` : ''}`);
  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }
  const data = next as unknown as Prisma.InputJsonValue;
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId, module: SUBSCRIPTION_MODULE } },
    create: { organizationId, module: SUBSCRIPTION_MODULE, data },
    update: { data },
  });
  console.log('Written.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
