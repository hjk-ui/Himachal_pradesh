/**
 * Phase 1 — read-only compare of local Postgres vs RDS via SSH tunnel.
 * Local Prisma client: process.env.DATABASE_URL (exact).
 * RDS Prisma client: process.env.RDS_DATABASE_URL (exact). Never derived from DATABASE_URL.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const TABLES = [
  'Organization',
  'Location',
  'User',
  'UserLocation',
  'EmailOtp',
  'Client',
  'CheckIn',
  'Appointment',
  'ProgressNote',
  'ProgressNoteWorkflow',
  'RiskAlert',
  'Message',
  'WaitlistEntry',
  'IntakeInvite',
  'ConsentForm',
  'TreatmentPlan',
  'EligibilityCheck',
  'PriorAuth',
  'Claim',
  'ClinicModuleState',
] as const;

type TableName = (typeof TABLES)[number];

function maskEmail(email: string | null | undefined) {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return '(invalid)';
  const u = user || '';
  const shown = u.slice(0, 1);
  return `${shown}***@${domain}`;
}

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

function clientFor(url: string) {
  return new PrismaClient({
    datasourceUrl: url,
    log: ['error'],
  });
}

async function tableExists(db: PrismaClient, table: string) {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${table}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function countRows(db: PrismaClient, table: TableName) {
  const rows = await db.$queryRawUnsafe<Array<{ c: number }>>(
    `SELECT COUNT(*)::int AS c FROM "${table}"`
  );
  return rows[0]?.c ?? 0;
}

async function idRows(db: PrismaClient, table: TableName) {
  if (table === 'ProgressNoteWorkflow') {
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "noteId" AS id FROM "${table}"`
    );
    return rows.map((r) => r.id);
  }
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "${table}"`);
  return rows.map((r) => r.id);
}

function diffSets(local: string[], rds: string[]) {
  const rdsSet = new Set(rds);
  const localSet = new Set(local);
  const localOnly = local.filter((id) => !rdsSet.has(id));
  const rdsOnly = rds.filter((id) => !localSet.has(id));
  const overlapping = local.filter((id) => rdsSet.has(id));
  return { localOnly, rdsOnly, overlapping };
}

async function main() {
  const localUrl = process.env.DATABASE_URL;
  if (!localUrl) {
    throw new Error('DATABASE_URL is missing');
  }

  const rdsUrl = process.env.RDS_DATABASE_URL;
  if (!rdsUrl) {
    throw new Error(
      'RDS_DATABASE_URL is missing. Set it in .env to postgresql://…@127.0.0.1:5433/altrixs_local?sslmode=require then re-run.'
    );
  }

  assertRdsUsesSshTunnel(rdsUrl);

  console.log(`LOCAL: ${formatEndpoint(localUrl)}`);
  console.log(`RDS:   ${formatEndpoint(rdsUrl)}`);

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    phase: 1,
    writes: false,
    connections: {
      local: formatEndpoint(localUrl),
      rds: formatEndpoint(rdsUrl),
      rdsUrlSource: 'RDS_DATABASE_URL (exact, unmodified)',
    },
    tables: {} as Record<string, unknown>,
    identityConflicts: {
      organizationSlug: [] as unknown[],
      userEmail: [] as unknown[],
      clientEmail: [] as unknown[],
      locationOrgName: [] as unknown[],
      intakeInviteToken: [] as unknown[],
      clinicModuleOrgModule: [] as unknown[],
    },
    notes: [
      'Phase 1 is read-only. No rows were inserted, updated, or deleted.',
      'Same primary key on both sides = overlapping (already present on RDS; merge should skip).',
      'Local-only IDs are merge candidates after FK remap.',
      'Same unique key (email/slug/token) with different IDs = conflict: do not insert a second row; map local ID → existing RDS ID.',
    ],
  };

  const local = clientFor(localUrl);
  const rds = clientFor(rdsUrl);

  try {
    await local.$queryRaw`SELECT 1`;
    await rds.$queryRaw`SELECT 1`;
    const localDb = await local.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const rdsDb = await rds.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    report.connectivity = {
      local: 'ok',
      rds: 'ok',
      localCurrentDatabase: localDb[0]?.current_database,
      rdsCurrentDatabase: rdsDb[0]?.current_database,
    };
    console.log(`LOCAL connected database: ${localDb[0]?.current_database}`);
    console.log(`RDS connected database:   ${rdsDb[0]?.current_database}`);

    for (const table of TABLES) {
      const localExists = await tableExists(local, table);
      const rdsExists = await tableExists(rds, table);
      if (!localExists && !rdsExists) {
        (report.tables as Record<string, unknown>)[table] = {
          localExists: false,
          rdsExists: false,
        };
        continue;
      }
      if (!localExists || !rdsExists) {
        (report.tables as Record<string, unknown>)[table] = {
          localExists,
          rdsExists,
          localCount: localExists ? await countRows(local, table) : 0,
          rdsCount: rdsExists ? await countRows(rds, table) : 0,
          note: !rdsExists
            ? 'Table missing on RDS — prisma db push on RDS (non-destructive) needed before merge of this model.'
            : 'Table missing on local.',
        };
        continue;
      }

      const [localCount, rdsCount, localIds, rdsIds] = await Promise.all([
        countRows(local, table),
        countRows(rds, table),
        idRows(local, table),
        idRows(rds, table),
      ]);
      const diff = diffSets(localIds, rdsIds);
      (report.tables as Record<string, unknown>)[table] = {
        localExists: true,
        rdsExists: true,
        localCount,
        rdsCount,
        overlappingIds: diff.overlapping.length,
        localOnlyIds: diff.localOnly.length,
        rdsOnlyIds: diff.rdsOnly.length,
        sampleLocalOnlyIds: diff.localOnly.slice(0, 40),
        sampleRdsOnlyIds: diff.rdsOnly.slice(0, 20),
        sampleOverlappingIds: diff.overlapping.slice(0, 20),
      };
    }

    // Unique-key conflicts (different IDs)
    if (
      (await tableExists(local, 'Organization')) &&
      (await tableExists(rds, 'Organization'))
    ) {
      const localOrgs = await local.$queryRaw<Array<{ id: string; slug: string; name: string }>>`
        SELECT id, slug, name FROM "Organization"
      `;
      const rdsOrgs = await rds.$queryRaw<Array<{ id: string; slug: string; name: string }>>`
        SELECT id, slug, name FROM "Organization"
      `;
      const rdsBySlug = new Map(rdsOrgs.map((o) => [o.slug, o]));
      for (const o of localOrgs) {
        const other = rdsBySlug.get(o.slug);
        if (other && other.id !== o.id) {
          (report.identityConflicts as { organizationSlug: unknown[] }).organizationSlug.push({
            slug: o.slug,
            localId: o.id,
            rdsId: other.id,
            localName: o.name,
            rdsName: other.name,
          });
        }
      }
    }

    if ((await tableExists(local, 'User')) && (await tableExists(rds, 'User'))) {
      const localUsers = await local.$queryRaw<Array<{ id: string; email: string }>>`
        SELECT id, email FROM "User"
      `;
      const rdsUsers = await rds.$queryRaw<Array<{ id: string; email: string }>>`
        SELECT id, email FROM "User"
      `;
      const rdsByEmail = new Map(rdsUsers.map((u) => [u.email.toLowerCase(), u]));
      for (const u of localUsers) {
        const other = rdsByEmail.get(u.email.toLowerCase());
        if (other && other.id !== u.id) {
          (report.identityConflicts as { userEmail: unknown[] }).userEmail.push({
            email: maskEmail(u.email),
            localId: u.id,
            rdsId: other.id,
          });
        }
      }
    }

    if ((await tableExists(local, 'Client')) && (await tableExists(rds, 'Client'))) {
      const localClients = await local.$queryRaw<
        Array<{ id: string; email: string | null; name: string }>
      >`SELECT id, email, name FROM "Client"`;
      const rdsClients = await rds.$queryRaw<Array<{ id: string; email: string | null }>>`
        SELECT id, email FROM "Client"
      `;
      const rdsByEmail = new Map(
        rdsClients
          .filter((c) => c.email)
          .map((c) => [c.email!.toLowerCase(), c])
      );
      for (const c of localClients) {
        if (!c.email) continue;
        const other = rdsByEmail.get(c.email.toLowerCase());
        if (other && other.id !== c.id) {
          (report.identityConflicts as { clientEmail: unknown[] }).clientEmail.push({
            email: maskEmail(c.email),
            localId: c.id,
            rdsId: other.id,
          });
        }
      }
    }

    if (
      (await tableExists(local, 'Location')) &&
      (await tableExists(rds, 'Location')) &&
      (await tableExists(local, 'Organization')) &&
      (await tableExists(rds, 'Organization'))
    ) {
      const localLocs = await local.$queryRaw<
        Array<{ id: string; name: string; organizationId: string; slug: string }>
      >`
        SELECT l.id, l.name, l."organizationId", o.slug
        FROM "Location" l
        JOIN "Organization" o ON o.id = l."organizationId"
      `;
      const rdsLocs = await rds.$queryRaw<
        Array<{ id: string; name: string; organizationId: string; slug: string }>
      >`
        SELECT l.id, l.name, l."organizationId", o.slug
        FROM "Location" l
        JOIN "Organization" o ON o.id = l."organizationId"
      `;
      const rdsKey = new Map(rdsLocs.map((l) => [`${l.slug}::${l.name}`, l]));
      for (const l of localLocs) {
        const other = rdsKey.get(`${l.slug}::${l.name}`);
        if (other && other.id !== l.id) {
          (report.identityConflicts as { locationOrgName: unknown[] }).locationOrgName.push({
            orgSlug: l.slug,
            name: l.name,
            localId: l.id,
            rdsId: other.id,
            localOrgId: l.organizationId,
            rdsOrgId: other.organizationId,
          });
        }
      }
    }

    if (
      (await tableExists(local, 'IntakeInvite')) &&
      (await tableExists(rds, 'IntakeInvite'))
    ) {
      const localInv = await local.$queryRaw<Array<{ id: string; token: string }>>`
        SELECT id, token FROM "IntakeInvite"
      `;
      const rdsInv = await rds.$queryRaw<Array<{ id: string; token: string }>>`
        SELECT id, token FROM "IntakeInvite"
      `;
      const rdsByToken = new Map(rdsInv.map((i) => [i.token, i]));
      for (const i of localInv) {
        const other = rdsByToken.get(i.token);
        if (other && other.id !== i.id) {
          (report.identityConflicts as { intakeInviteToken: unknown[] }).intakeInviteToken.push({
            localId: i.id,
            rdsId: other.id,
            tokenPrefix: i.token.slice(0, 8) + '…',
          });
        }
      }
    }

    if (
      (await tableExists(local, 'ClinicModuleState')) &&
      (await tableExists(rds, 'ClinicModuleState'))
    ) {
      const localMods = await local.$queryRaw<
        Array<{ id: string; organizationId: string; module: string }>
      >`SELECT id, "organizationId", module FROM "ClinicModuleState"`;
      const rdsMods = await rds.$queryRaw<
        Array<{ id: string; organizationId: string; module: string }>
      >`SELECT id, "organizationId", module FROM "ClinicModuleState"`;
      const rdsById = new Map(rdsMods.map((m) => [m.id, m]));
      // also match by org id + module (same org id) vs remapped org later
      const rdsByOrgModule = new Map(rdsMods.map((m) => [`${m.organizationId}::${m.module}`, m]));
      for (const m of localMods) {
        const sameId = rdsById.get(m.id);
        if (sameId) continue;
        const other = rdsByOrgModule.get(`${m.organizationId}::${m.module}`);
        if (other && other.id !== m.id) {
          (report.identityConflicts as { clinicModuleOrgModule: unknown[] }).clinicModuleOrgModule.push(
            {
              module: m.module,
              organizationId: m.organizationId,
              localId: m.id,
              rdsId: other.id,
            }
          );
        }
      }
    }
  } finally {
    await local.$disconnect();
    await rds.$disconnect();
  }

  const dir = join(dirname(fileURLToPath(import.meta.url)), 'reports');
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, 'phase1-compare.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const tables = report.tables as Record<
    string,
    {
      localCount?: number;
      rdsCount?: number;
      overlappingIds?: number;
      localOnlyIds?: number;
      rdsOnlyIds?: number;
      rdsExists?: boolean;
      localExists?: boolean;
      note?: string;
    }
  >;
  const lines = [
    `Phase 1 compare ${report.generatedAt}`,
    `LOCAL: ${formatEndpoint(localUrl)}`,
    `RDS:   ${formatEndpoint(rdsUrl)}`,
    '',
    'TABLE'.padEnd(24) +
      'LOCAL'.padStart(8) +
      'RDS'.padStart(8) +
      'SAME_ID'.padStart(10) +
      'LOCAL_ONLY'.padStart(12) +
      'RDS_ONLY'.padStart(10),
  ];
  for (const table of TABLES) {
    const t = tables[table];
    if (!t) continue;
    if (t.localExists === false && t.rdsExists === false) continue;
    lines.push(
      table.padEnd(24) +
        String(t.localCount ?? '-').padStart(8) +
        String(t.rdsCount ?? '-').padStart(8) +
        String(t.overlappingIds ?? '-').padStart(10) +
        String(t.localOnlyIds ?? '-').padStart(12) +
        String(t.rdsOnlyIds ?? '-').padStart(10) +
        (t.note ? `  ${t.note}` : '')
    );
  }
  const conflicts = report.identityConflicts as Record<string, unknown[]>;
  lines.push('');
  lines.push('Identity conflicts (same unique key, different IDs):');
  for (const [k, v] of Object.entries(conflicts)) {
    lines.push(`  ${k}: ${v.length}`);
  }
  const txtPath = join(dir, 'phase1-compare.txt');
  writeFileSync(txtPath, lines.join('\n') + '\n', 'utf8');

  console.log(lines.join('\n'));
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${txtPath}`);
  console.log('\nNo database writes were performed.');
}

main().catch((err) => {
  console.error('Phase 1 compare failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
