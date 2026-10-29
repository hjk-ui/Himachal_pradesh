import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('BaaAcceptance','IntegrationCallLog') ORDER BY 1`
  );
  console.log('tables', tables);

  const mig = await prisma.$queryRawUnsafe<
    Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
  >(
    `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`
  );
  console.log('total migrations recorded', mig.length);
  for (const m of mig) {
    if (
      m.migration_name.includes('20261025') ||
      m.migration_name.includes('20261026') ||
      m.migration_name.includes('20261027')
    ) {
      console.log(
        m.migration_name,
        'finished=',
        Boolean(m.finished_at),
        'rolled_back=',
        Boolean(m.rolled_back_at)
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
