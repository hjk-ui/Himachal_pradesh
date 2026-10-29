/**
 * Phase 1.5 — read-only Prisma schema preview against RDS (SSH tunnel).
 * Does not push, migrate, or execute SQL.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const EXPECTED_NEW_TABLES = ['TreatmentPlan', 'EligibilityCheck', 'PriorAuth', 'Claim'];
const EXPECTED_NEW_ENUMS = [
  'TreatmentPlanStatus',
  'EligibilityCheckStatus',
  'PriorAuthStatus',
  'ClaimStatus',
];

const DESTRUCTIVE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
  { name: 'DROP TYPE', re: /\bDROP\s+TYPE\b/i },
  { name: 'DROP INDEX', re: /\bDROP\s+INDEX\b/i },
  { name: 'DROP CONSTRAINT', re: /\bDROP\s+CONSTRAINT\b/i },
  { name: 'TRUNCATE', re: /\bTRUNCATE\b/i },
  { name: 'DELETE FROM', re: /\bDELETE\s+FROM\b/i },
  { name: 'ALTER ... DROP', re: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i },
  { name: 'ALTER TYPE DROP VALUE', re: /\bALTER\s+TYPE\b[\s\S]*?\bDROP\s+VALUE\b/i },
  { name: 'RENAME COLUMN', re: /\bRENAME\s+COLUMN\b/i },
  { name: 'SET DATA TYPE / ALTER COLUMN TYPE', re: /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i },
];

function parseEndpoint(raw: string) {
  const u = new URL(raw);
  const database = decodeURIComponent(u.pathname.replace(/^\//, '')).split('?')[0];
  return {
    hostname: u.hostname,
    port: u.port || '5432',
    database,
  };
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
      `RDS_DATABASE_URL must target the SSH tunnel 127.0.0.1:5433 (got ${e.hostname}:${e.port} / ${e.database}). Direct RDS hostnames or port 5432 are not allowed from this machine.`
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

function parseSql(sql: string) {
  const statements = sql
    .split(';')
    .map((s) =>
      s
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter((s) => s.length > 0);

  const tablesCreated: string[] = [];
  const enumsCreated: string[] = [];
  const indexes: string[] = [];
  const uniqueConstraints: string[] = [];
  const foreignKeys: string[] = [];
  const columnsAdded: string[] = [];
  const other: string[] = [];

  for (const stmt of statements) {
    const createTable = stmt.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z0-9_]+)"?/i);
    const createEnum = stmt.match(/CREATE\s+TYPE\s+"?([A-Za-z0-9_]+)"?\s+AS\s+ENUM/i);
    const createIndex = stmt.match(/CREATE\s+(UNIQUE\s+)?INDEX(?:\s+"?([A-Za-z0-9_]+)"?)?/i);
    const addColumn = stmt.match(
      /ALTER\s+TABLE\s+"?([A-Za-z0-9_]+)"?\s+ADD\s+COLUMN\s+"?([A-Za-z0-9_]+)"?/i
    );
    const uniqueIndex = stmt.match(
      /CREATE\s+UNIQUE\s+INDEX\s+"?([A-Za-z0-9_]+)"?\s+ON\s+"?([A-Za-z0-9_]+)"?\s*\("?([A-Za-z0-9_]+)"?\)/i
    );
    const unique = stmt.match(
      /ALTER\s+TABLE\s+"?([A-Za-z0-9_]+)"?[\s\S]*?ADD\s+CONSTRAINT\s+"?([A-Za-z0-9_]+)"?\s+UNIQUE/i
    );
    const fk = stmt.match(
      /ALTER\s+TABLE\s+"?([A-Za-z0-9_]+)"?[\s\S]*?ADD\s+CONSTRAINT\s+"?([A-Za-z0-9_]+)"?\s+FOREIGN\s+KEY\s*\("?([A-Za-z0-9_]+)"?\)\s+REFERENCES\s+"?([A-Za-z0-9_]+)"?\s*\("?([A-Za-z0-9_]+)"?\)[\s\S]*?(ON\s+DELETE\s+[A-Z]+(?:\s+[A-Z]+)*)?/i
    );

    if (createTable) tablesCreated.push(createTable[1]);
    else if (createEnum) enumsCreated.push(createEnum[1]);
    else if (uniqueIndex) uniqueConstraints.push(`${uniqueIndex[2]}.${uniqueIndex[3]} (${uniqueIndex[1]})`);
    else if (unique) uniqueConstraints.push(`${unique[1]}.${unique[2]}`);
    else if (fk) {
      foreignKeys.push(
        `${fk[1]}.${fk[3]} → ${fk[4]}.${fk[5]} (${fk[2]}${fk[6] ? `, ${fk[6].trim()}` : ''})`
      );
    } else if (createIndex) indexes.push(stmt.replace(/\s+/g, ' ').slice(0, 240));
    else if (addColumn) columnsAdded.push(`${addColumn[1]}.${addColumn[2]}`);
    else other.push(stmt.replace(/\s+/g, ' ').slice(0, 240));
  }

  const destructiveHits = DESTRUCTIVE_PATTERNS.filter((p) => p.re.test(sql)).map((p) => p.name);

  return {
    statementCount: statements.length,
    tablesCreated,
    enumsCreated,
    indexes,
    uniqueConstraints,
    foreignKeys,
    columnsAdded,
    other,
    destructiveHits,
  };
}

function runPrismaDiff(args: string[], rdsUrl: string) {
  const result = spawnSync('npx', ['prisma', 'migrate', 'diff', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    shell: true,
    env: { ...process.env, RDS_DATABASE_URL: rdsUrl },
  });
  const stdout = redact(`${result.stdout || ''}`, rdsUrl);
  const stderr = redact(`${result.stderr || ''}`, rdsUrl);
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(
      `prisma migrate diff failed (exit ${result.status}): ${stderr || stdout || 'no output'}`
    );
  }
  return { stdout, stderr, status: result.status };
}

async function inspectRds(rdsUrl: string) {
  const rds = new PrismaClient({ datasourceUrl: rdsUrl, log: ['error'] });
  try {
    const db = await rds.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const tables = await rds.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const enums = await rds.$queryRaw<Array<{ typname: string }>>`
      SELECT t.typname
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
      ORDER BY t.typname
    `;
    const existingTables = tables.map((t) => t.table_name);
    const existingEnums = enums.map((t) => t.typname);
    const userColumns = await rds.$queryRaw<
      Array<{ column_name: string; data_type: string; udt_name: string; column_default: string | null }>
    >`
      SELECT column_name, data_type, udt_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User'
      ORDER BY ordinal_position
    `;
    return {
      currentDatabase: db[0]?.current_database,
      existingTables,
      existingEnums,
      missingTables: EXPECTED_NEW_TABLES.filter((t) => !existingTables.includes(t)),
      missingEnums: EXPECTED_NEW_ENUMS.filter((t) => !existingEnums.includes(t)),
      alreadyPresentTables: EXPECTED_NEW_TABLES.filter((t) => existingTables.includes(t)),
      alreadyPresentEnums: EXPECTED_NEW_ENUMS.filter((t) => existingEnums.includes(t)),
      userColumns,
      userHasRolesColumn: userColumns.some((c) => c.column_name === 'roles'),
    };
  } finally {
    await rds.$disconnect();
  }
}

async function main() {
  const rdsUrl = process.env.RDS_DATABASE_URL;
  if (!rdsUrl) {
    throw new Error('RDS_DATABASE_URL is missing');
  }
  assertRdsUsesSshTunnel(rdsUrl);
  console.log(`RDS: ${formatEndpoint(rdsUrl)}`);
  console.log('Mode: PREVIEW ONLY — prisma migrate diff (read-only). No db push, no execute.');

  const here = dirname(fileURLToPath(import.meta.url));
  const reportsDir = join(here, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const sqlPath = join(reportsDir, 'phase1.5-schema.sql');
  const summaryPath = join(reportsDir, 'phase1.5-schema-summary.txt');
  const jsonPath = join(reportsDir, 'phase1.5-schema.json');

  const rdsInspect = await inspectRds(rdsUrl);
  console.log(`RDS connected database: ${rdsInspect.currentDatabase}`);

  const schemaPath = join(here, '..', '..', 'prisma', 'schema.prisma');
  const fromUrl = ['--from-url', rdsUrl];
  const toSchema = ['--to-schema-datamodel', schemaPath];

  const summary = runPrismaDiff([...fromUrl, ...toSchema], rdsUrl);
  const script = runPrismaDiff([...fromUrl, ...toSchema, '--script'], rdsUrl);
  const sql = script.stdout.trim() || '-- Empty diff: schema already matches.\n';
  const parsed = parseSql(sql);

  const unexpectedTables = parsed.tablesCreated.filter((t) => !EXPECTED_NEW_TABLES.includes(t));
  const unexpectedEnums = parsed.enumsCreated.filter((t) => !EXPECTED_NEW_ENUMS.includes(t));
  const extraSafeColumns = parsed.columnsAdded.filter((c) => c === 'User.roles');
  const unexpectedColumns = parsed.columnsAdded.filter((c) => c !== 'User.roles');

  let verdict = 'SAFE_ADDITIVE_PREVIEW';
  if (parsed.destructiveHits.length > 0) {
    verdict = 'STOP_DESTRUCTIVE_CHANGES_DETECTED';
  } else if (unexpectedTables.length || unexpectedEnums.length || unexpectedColumns.length) {
    verdict = 'STOP_UNEXPECTED_NON_ADDITIVE_OR_UNEXPECTED_OBJECTS';
  } else if (extraSafeColumns.length) {
    verdict = 'SAFE_ADDITIVE_PREVIEW_PLUS_USER_ROLES_COLUMN';
  }

  writeFileSync(sqlPath, sql.endsWith('\n') ? sql : `${sql}\n`, 'utf8');
  writeFileSync(summaryPath, redact(summary.stdout, rdsUrl), 'utf8');

  const report = {
    generatedAt: new Date().toISOString(),
    phase: '1.5',
    writes: false,
    applied: false,
    prismaDbPushDryRunSupported: false,
    method: 'prisma migrate diff --from-url RDS_DATABASE_URL --to-schema-datamodel prisma/schema.prisma',
    connections: {
      rds: formatEndpoint(rdsUrl),
      rdsUrlSource: 'RDS_DATABASE_URL (exact, unmodified)',
    },
    rdsInspect,
    expectedNewTables: EXPECTED_NEW_TABLES,
    expectedNewEnums: EXPECTED_NEW_ENUMS,
    parsed,
    verdict,
    notes: [
      'prisma db push --dry-run is not supported in Prisma 6.19.0.',
      'prisma migrate diff is read-only and does not apply SQL.',
      'Do not run prisma db push, prisma db execute, or migrate reset until explicitly approved.',
      'Existing RDS rows are not modified by this preview.',
      'Unexpected extra additive change vs Phase 1 missing-tables list: User.roles Role[] DEFAULT []. Existing User.role and all User rows would remain. New column would be empty array on existing rows.',
    ],
  };
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`Verdict: ${verdict}`);
  console.log(`Tables that would be created: ${parsed.tablesCreated.join(', ') || '(none)'}`);
  console.log(`Enums that would be created:  ${parsed.enumsCreated.join(', ') || '(none)'}`);
  console.log(`Columns added to existing tables: ${parsed.columnsAdded.join(', ') || '(none)'}`);
  console.log(`Destructive patterns: ${parsed.destructiveHits.join(', ') || '(none)'}`);
  console.log(`Wrote ${sqlPath}`);
  console.log(`Wrote ${summaryPath}`);
  console.log(`Wrote ${jsonPath}`);
  console.log('No schema changes were applied.');
}

main().catch((err) => {
  console.error(`Phase 1.5 schema preview failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
