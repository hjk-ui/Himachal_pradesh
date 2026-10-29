/**
 * READ-ONLY check of the report library on staging. Runs every report with its default parameters
 * as a leadership context (org-wide scope) and prints, per report: id, row count, KPI values,
 * run time and the data sources that had no data. Never writes: it calls the plain lib runners
 * (no API route, no audit rows, no next-auth). Output is counts only: no names, no row values.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/check-report-library.ts
 *   ... --org=<organizationId>   required when the database has more than one organization
 *   ... --only=ar-aging,denials  run a subset
 *   ... --timeout=30000          per-report timeout in ms (default 30000)
 */
import { prisma } from '@/lib/db/prisma';
import { REPORTS } from '@/lib/reports/library/registry';
import { buildReportContext } from '@/lib/reports/library/context';
import { resolveReportParams } from '@/lib/reports/library/params';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const ONLY = (arg('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const TIMEOUT = Math.max(1000, Number(arg('timeout') ?? 30000) || 30000);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const SLOW_MS = 3000;

function kpiText(v: unknown): string {
  if (v === null || v === undefined) return 'no data';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return String(v).slice(0, 12);
}

async function main() {
  let orgId = arg('org');
  if (!orgId) {
    const orgs = await prisma.organization.findMany({ select: { id: true }, take: 2 });
    if (orgs.length !== 1) throw new Error(`Pass --org=<organizationId> (${orgs.length} organizations found)`);
    orgId = orgs[0].id;
  }
  // A real leadership account when there is one (its Part 2 whitelist applies), else a synthetic ADMIN.
  const leader = await prisma.user.findFirst({
    where: { organizationId: orgId, status: 'ACTIVE', role: { in: ['PRACTICE_DIRECTOR', 'ADMIN', 'DIRECTOR'] } },
    select: { id: true, role: true },
    orderBy: { createdAt: 'asc' },
  });
  const viewer = { organizationId: orgId, userId: leader?.id ?? 'report-library-check', role: leader?.role ?? 'ADMIN' };
  const timeZone = await getPracticeTimeZone(orgId);
  const now = new Date();
  console.log(`Report library check  org=${orgId}  viewer role=${viewer.role}${leader ? '' : ' (synthetic)'}  tz=${timeZone}  at=${now.toISOString()}`);
  console.log(`${pad('report', 30)} ${pad('rows', 7)} ${pad('ms', 7)} KPIs | no-data sources`);

  const list = REPORTS.filter((r) => !ONLY.length || ONLY.includes(r.id));
  let failed = 0;
  let slow = 0;
  for (const def of list) {
    const parsed = resolveReportParams(def, {}, { now, timeZone });
    if ('error' in parsed) {
      console.log(`${pad(def.id, 30)} PARAM ERROR ${parsed.error}`);
      failed++;
      continue;
    }
    const started = Date.now();
    try {
      const ctx = await buildReportContext(viewer, parsed.params, { now, timeZone });
      const out = await Promise.race([
        def.run(ctx, parsed.params),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${TIMEOUT} ms`)), TIMEOUT)),
      ]);
      const ms = Date.now() - started;
      if (ms > SLOW_MS) slow++;
      const kpis = (out.kpis ?? []).map((k) => `${k.label}=${kpiText(k.value)}`).join('; ');
      const empty = out.sources.filter((s) => s.empty).map((s) => s.name);
      console.log(`${pad(def.id, 30)} ${pad(out.rows.length, 7)} ${pad(ms, 7)} ${kpis || '-'}${empty.length ? ` | NO DATA: ${empty.join(', ')}` : ''}${ms > SLOW_MS ? '  [SLOW]' : ''}`);
    } catch (err) {
      failed++;
      console.log(`${pad(def.id, 30)} ERROR ${err instanceof Error ? `${err.name}: ${err.message.split('\n')[0].slice(0, 200)}` : 'unknown'}`);
    }
  }
  console.log(`\n${list.length} reports, ${failed} failed, ${slow} over ${SLOW_MS} ms`);
  await prisma.$disconnect();
  if (failed) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
