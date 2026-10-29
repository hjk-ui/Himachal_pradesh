/**
 * Backfill Client.organizationId + Client.mrn for existing rows.
 *
 * Usage:
 *   npx tsx scripts/backfill-client-mrn.ts
 *
 * Safe to re-run (idempotent). Requires DATABASE_URL.
 */
import { prisma } from '../src/lib/db/prisma';
import { ensureClientMrn } from '../src/lib/clients/mrn';

async function main() {
  const clients = await prisma.client.findMany({
    where: {
      OR: [{ mrn: null }, { organizationId: null }],
    },
    select: { id: true, name: true, mrn: true, organizationId: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${clients.length} client(s) needing MRN / org backfill`);

  let ok = 0;
  let failed = 0;

  for (const c of clients) {
    try {
      const result = await ensureClientMrn(c.id);
      if (result.mrn && result.organizationId) {
        ok += 1;
        console.log(`  OK  ${c.name} → ${result.mrn}`);
      } else {
        failed += 1;
        console.warn(`  SKIP ${c.name} (${c.id}) — could not resolve organization`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  FAIL ${c.name} (${c.id})`, err);
    }
  }

  console.log(`Done. Assigned/ensured: ${ok}. Failed/skipped: ${failed}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
