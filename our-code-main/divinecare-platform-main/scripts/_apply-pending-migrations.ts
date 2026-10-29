/**
 * Apply prisma/migrations that are not finished in _prisma_migrations.
 * Uses `prisma db execute --file` (supports multi-statement SQL).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const root = join(process.cwd(), 'prisma', 'migrations');

function prismaDbExecute(file: string) {
  const res = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', file],
    { encoding: 'utf8', env: process.env, shell: true }
  );
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || `prisma db execute failed (${res.status})`);
  }
  return res.stdout;
}

async function main() {
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const applied = new Set(
    (
      await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
        `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
      )
    ).map((r) => r.migration_name)
  );

  console.log('already applied', applied.size, 'pending', dirs.length - applied.size);

  for (const name of dirs) {
    if (applied.has(name)) continue;
    const sqlPath = join(root, name, 'migration.sql');
    if (!existsSync(sqlPath)) {
      console.log('missing sql', name);
      continue;
    }
    const sql = readFileSync(sqlPath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    console.log('applying', name);
    const started = new Date();
    prismaDbExecute(sqlPath);
    const id = randomUUID();
    const finished = new Date();
    const mark = join(root, `_mark_${name}.sql`);
    writeFileSync(
      mark,
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES ('${id}', '${checksum}', '${finished.toISOString()}', '${name}', NULL, NULL, '${started.toISOString()}', 1);\n`
    );
    try {
      prismaDbExecute(mark);
      console.log('ok', name);
    } finally {
      try {
        unlinkSync(mark);
      } catch {
        /* ignore */
      }
    }
  }

  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('BaaAcceptance','IntegrationCallLog') ORDER BY 1`
  );
  console.log('tables after', tables.map((t) => t.tablename).join(',') || '(none)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
