/**
 * Local/staging repair: when schema objects already exist (db push / partial apply)
 * but _prisma_migrations is behind, mark drifted migrations as applied, then
 * execute only SQL for migrations whose target tables are still missing.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const root = join(process.cwd(), 'prisma', 'migrations');

/** Heuristic: first CREATE TABLE "Name" in the migration — if present, skip SQL and mark applied. */
function firstCreateTable(sql: string): string | null {
  const m = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\"([^\"]+)\"/i);
  return m?.[1] || null;
}

function prismaDbExecute(file: string) {
  const res = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'db', 'execute', '--schema', 'prisma/schema.prisma', '--file', file],
    { encoding: 'utf8', env: process.env, shell: true }
  );
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || `prisma db execute failed (${res.status})`);
  }
}

async function tableExists(name: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='${name.replace(/'/g, "''")}'
    ) AS exists`
  );
  return Boolean(rows[0]?.exists);
}

async function markApplied(name: string, sql: string) {
  const checksum = createHash('sha256').update(sql).digest('hex');
  const id = randomUUID();
  const now = new Date().toISOString();
  const mark = join(root, `_mark_${name}.sql`);
  writeFileSync(
    mark,
    `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT '${id}', '${checksum}', '${now}', '${name}', NULL, NULL, '${now}', 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name"='${name}');\n`
  );
  try {
    prismaDbExecute(mark);
  } finally {
    try {
      unlinkSync(mark);
    } catch {
      /* ignore */
    }
  }
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

  for (const name of dirs) {
    if (applied.has(name)) continue;
    const sqlPath = join(root, name, 'migration.sql');
    if (!existsSync(sqlPath)) continue;
    const sql = readFileSync(sqlPath, 'utf8');
    const table = firstCreateTable(sql);

    if (table && (await tableExists(table))) {
      console.log('mark-applied (table exists)', name, '->', table);
      await markApplied(name, sql);
      continue;
    }

    console.log('execute', name, table ? `(need ${table})` : '');
    try {
      prismaDbExecute(sqlPath);
      await markApplied(name, sql);
      console.log('ok', name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(msg)) {
        console.log('mark-applied after already-exists', name);
        await markApplied(name, sql);
        continue;
      }
      throw err;
    }
  }

  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('BaaAcceptance','IntegrationCallLog') ORDER BY 1`
  );
  const migCount = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
    `SELECT COUNT(*)::int AS c FROM _prisma_migrations WHERE finished_at IS NOT NULL`
  );
  console.log('tables', tables.map((t) => t.tablename));
  console.log('finished migrations', migCount[0]?.c);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
