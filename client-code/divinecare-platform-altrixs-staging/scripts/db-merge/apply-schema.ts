/**
 * Phase 1.5 apply — additive schema SQL on RDS only (SSH tunnel).
 * Applies scripts/db-merge/reports/phase1.5-schema.sql unchanged.
 * Does not use DATABASE_URL. Does not merge data.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const NEW_TABLES = ['TreatmentPlan', 'EligibilityCheck', 'PriorAuth', 'Claim'] as const;
const NEW_ENUMS = [
  'TreatmentPlanStatus',
  'EligibilityCheckStatus',
  'PriorAuthStatus',
  'ClaimStatus',
] as const;
const COUNT_TABLES = ['Client', 'User', 'Appointment', 'Message', 'CheckIn'] as const;

const DESTRUCTIVE =
  /\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+TYPE|DROP\s+INDEX|DROP\s+CONSTRAINT|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN[\s\S]*TYPE|RENAME\s+COLUMN|ACCEPT-DATA-LOSS)\b/i;

function parseEndpoint(raw: string) {
  const u = new URL(raw);
  const database = decodeURIComponent(u.pathname.replace(/^\//, '')).split('?')[0];
  return { hostname: u.hostname, port: u.port || '5432', database };
}

function formatEndpoint(raw: string) {
  const e = parseEndpoint(raw);
  return `${e.hostname}:${e.port} / ${e.database}`;
}

function assertRdsUsesSshTunnel(raw: string) {
  const e = parseEndpoint(raw);
  const loopback = e.hostname === '127.0.0.1' || e.hostname === 'localhost';
  if (!loopback || e.port !== '5433') {
    throw new Error(
      `RDS_DATABASE_URL must target the SSH tunnel 127.0.0.1:5433 (got ${e.hostname}:${e.port} / ${e.database}).`
    );
  }
}

function redact(text: string, url: string) {
  let out = text.replaceAll(url, '[RDS_DATABASE_URL]');
  try {
    const password = decodeURIComponent(new URL(url).password);
    if (password) out = out.replaceAll(password, '[redacted]');
  } catch {
    /* ignore */
  }
  return out;
}

function normalizeSql(sql: string) {
  return sql
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, ';')
    .replace(/;+$/, ';')
    .trim();
}

function statementsFromSql(sql: string) {
  return sql
    .split(';')
    .map((s) =>
      s
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter((s) => s.length > 0);
}

function liveDiffSql(rdsUrl: string, schemaPath: string) {
  const result = spawnSync(
    'npx',
    ['prisma', 'migrate', 'diff', '--from-url', rdsUrl, '--to-schema-datamodel', schemaPath, '--script'],
    { encoding: 'utf8', windowsHide: true, shell: true, env: { ...process.env } }
  );
  const stdout = redact(`${result.stdout || ''}`, rdsUrl);
  const stderr = redact(`${result.stderr || ''}`, rdsUrl);
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(`prisma migrate diff failed (exit ${result.status}): ${stderr || stdout || 'no output'}`);
  }
  return stdout.trim();
}

async function tableExists(db: PrismaClient, table: string) {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function columnExists(db: PrismaClient, table: string, column: string) {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function enumExists(db: PrismaClient, name: string) {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typname = ${name}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function countTable(db: PrismaClient, table: string) {
  const rows = await db.$queryRawUnsafe<Array<{ c: number }>>(`SELECT COUNT(*)::int AS c FROM "${table}"`);
  return rows[0]?.c ?? 0;
}

async function snapshot(db: PrismaClient) {
  const currentDatabase = (
    await db.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`
  )[0]?.current_database;
  const tables: Record<string, boolean> = {};
  for (const t of NEW_TABLES) tables[t] = await tableExists(db, t);
  const enums: Record<string, boolean> = {};
  for (const e of NEW_ENUMS) enums[e] = await enumExists(db, e);
  const counts: Record<string, number> = {};
  for (const t of COUNT_TABLES) counts[t] = await countTable(db, t);
  const newTableCounts: Record<string, number | null> = {};
  for (const t of NEW_TABLES) {
    newTableCounts[t] = tables[t] ? await countTable(db, t) : null;
  }
  return {
    currentDatabase,
    tables,
    enums,
    userRoles: await columnExists(db, 'User', 'roles'),
    counts,
    newTableCounts,
  };
}

async function main() {
  const rdsUrl = process.env.RDS_DATABASE_URL;
  if (!rdsUrl) throw new Error('RDS_DATABASE_URL is missing');
  assertRdsUsesSshTunnel(rdsUrl);

  const here = dirname(fileURLToPath(import.meta.url));
  const sqlPath = join(here, 'reports', 'phase1.5-schema.sql');
  const schemaPath = join(here, '..', '..', 'prisma', 'schema.prisma');
  const reportsDir = join(here, 'reports');
  mkdirSync(reportsDir, { recursive: true });

  const approvedSql = readFileSync(sqlPath, 'utf8');
  if (DESTRUCTIVE.test(approvedSql)) {
    throw new Error('STOP: approved SQL contains a destructive statement. Nothing applied.');
  }

  console.log(`RDS: ${formatEndpoint(rdsUrl)}`);
  console.log('Applying approved Phase 1.5 SQL to RDS only. Local DATABASE_URL is unused.');

  const rds = new PrismaClient({ datasourceUrl: rdsUrl, log: ['error'] });
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    phase: '1.5-apply',
    rds: formatEndpoint(rdsUrl),
    sqlFile: sqlPath,
    usedLocalDatabaseUrl: false,
    acceptDataLoss: false,
    phase2: false,
  };

  try {
    const before = await snapshot(rds);
    report.before = before;
    console.log(`RDS connected database: ${before.currentDatabase}`);
    console.log(
      `Before counts: Client=${before.counts.Client} User=${before.counts.User} Appointment=${before.counts.Appointment} Message=${before.counts.Message} CheckIn=${before.counts.CheckIn}`
    );

    const unexpectedExisting = NEW_TABLES.filter((t) => before.tables[t]);
    const unexpectedEnums = NEW_ENUMS.filter((e) => before.enums[e]);
    if (unexpectedExisting.length || unexpectedEnums.length || before.userRoles) {
      throw new Error(
        `STOP: RDS already has objects the preview assumed were missing (tables=${unexpectedExisting.join(',') || 'none'} enums=${unexpectedEnums.join(',') || 'none'} User.roles=${before.userRoles}). Nothing applied.`
      );
    }

    const liveSql = liveDiffSql(rdsUrl, schemaPath);
    if (normalizeSql(liveSql) !== normalizeSql(approvedSql)) {
      writeFileSync(join(reportsDir, 'phase1.5-live-diff-mismatch.sql'), `${liveSql}\n`, 'utf8');
      throw new Error(
        'STOP: live prisma migrate diff no longer matches scripts/db-merge/reports/phase1.5-schema.sql. Nothing applied.'
      );
    }
    report.liveDiffMatchesApprovedSql = true;

    const statements = statementsFromSql(approvedSql);
    for (const stmt of statements) {
      if (DESTRUCTIVE.test(stmt)) {
        throw new Error(`STOP: refusing statement: ${stmt.slice(0, 80)}`);
      }
    }

    const exec = spawnSync(
      'npx',
      ['prisma', 'db', 'execute', '--file', sqlPath, '--url', rdsUrl],
      {
        encoding: 'utf8',
        windowsHide: true,
        shell: true,
        env: { ...process.env, DATABASE_URL: '' },
      }
    );
    const execOut = redact(`${exec.stdout || ''}\n${exec.stderr || ''}`, rdsUrl);
    if (exec.status !== 0) {
      throw new Error(`prisma db execute failed (exit ${exec.status}): ${execOut.trim() || 'no output'}`);
    }
    report.appliedVia = 'prisma db execute --file phase1.5-schema.sql --url RDS_DATABASE_URL';
    report.executeOutput = execOut.trim();
    report.appliedStatements = statements.length;
    report.applied = true;

    const after = await snapshot(rds);
    report.after = after;

    const countDrift = COUNT_TABLES.filter((t) => after.counts[t] !== before.counts[t]);
    const missingTables = NEW_TABLES.filter((t) => !after.tables[t]);
    const missingEnums = NEW_ENUMS.filter((e) => !after.enums[e]);

    report.verification = {
      fourTablesExist: missingTables.length === 0,
      missingTables,
      enumsExist: missingEnums.length === 0,
      missingEnums,
      userRolesExists: after.userRoles,
      countDrift,
      newTablesEmpty: NEW_TABLES.every((t) => after.newTableCounts[t] === 0),
    };

    if (missingTables.length || missingEnums.length || !after.userRoles) {
      throw new Error(
        `Schema apply ran but verification failed (tables=${missingTables.join(',')} enums=${missingEnums.join(',')} User.roles=${after.userRoles}).`
      );
    }
    if (countDrift.length) {
      throw new Error(`STOP after apply: row counts changed for ${countDrift.join(', ')}.`);
    }

    const postDiff = liveDiffSql(rdsUrl, schemaPath);
    const postNorm = normalizeSql(postDiff);
    const schemaInSync = postNorm.length === 0 || /^-- This is an empty diff\.?$/i.test(postDiff.trim());
    report.postApplyMigrateDiffEmpty = schemaInSync;
    report.postApplyMigrateDiffPreview = postDiff.slice(0, 500);

    console.log(
      `After counts:  Client=${after.counts.Client} User=${after.counts.User} Appointment=${after.counts.Appointment} Message=${after.counts.Message} CheckIn=${after.counts.CheckIn}`
    );
    console.log(`Tables created: ${NEW_TABLES.join(', ')} (row counts ${NEW_TABLES.map((t) => `${t}=${after.newTableCounts[t]}`).join(', ')})`);
    console.log(`User.roles exists: ${after.userRoles}`);
    console.log(`Schema in sync with prisma schema: ${schemaInSync}`);
    console.log('Phase 2 was not started.');
  } finally {
    await rds.$disconnect();
  }

  const jsonPath = join(reportsDir, 'phase1.5-apply.json');
  const txtPath = join(reportsDir, 'phase1.5-apply.txt');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const before = report.before as { counts: Record<string, number> };
  const after = report.after as { counts: Record<string, number>; newTableCounts: Record<string, number | null> };
  writeFileSync(
    txtPath,
    [
      `Phase 1.5 apply ${report.generatedAt}`,
      `RDS: ${report.rds}`,
      `SQL: ${sqlPath}`,
      '',
      'BEFORE counts:',
      `  Client=${before.counts.Client} User=${before.counts.User} Appointment=${before.counts.Appointment} Message=${before.counts.Message} CheckIn=${before.counts.CheckIn}`,
      'AFTER counts:',
      `  Client=${after.counts.Client} User=${after.counts.User} Appointment=${after.counts.Appointment} Message=${after.counts.Message} CheckIn=${after.counts.CheckIn}`,
      `New tables: ${NEW_TABLES.map((t) => `${t}=${after.newTableCounts[t]}`).join(' ')}`,
      `User.roles: ${(report.after as { userRoles: boolean }).userRoles}`,
      `Applied statements: ${report.appliedStatements}`,
      'Phase 2: not started',
      '',
    ].join('\n'),
    'utf8'
  );
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${txtPath}`);
}

main().catch((err) => {
  console.error(`Phase 1.5 apply failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
