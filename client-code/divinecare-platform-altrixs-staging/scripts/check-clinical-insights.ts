/**
 * READ-ONLY check of Clinical Insights on staging. Never writes (no snapshot, no audit rows): it
 * calls the plain lib loaders directly, not the API routes, and imports no next-auth code.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/check-clinical-insights.ts
 *   ... --org=<organizationId>   required when the database has more than one organization
 *   ... --samples=5              sample clients to print (default 5)
 *
 * Output (ids, MRNs, counts, signal keys, values and dates only — no names, no free text):
 *   1. Live evaluation of every active client (org-wide, system scope): timing, tier counts, and
 *      the expectation check: Urgent + High + Watch should be a small, actionable share
 *      (ATTENTION_TARGET, 15%); the "possibly disengaged" outreach list is reported separately
 *   2. Signal counts
 *   3. Data coverage (share of clients with any PHQ-9, a visit, a future appointment, ...)
 *   4. Tile vs list consistency for several filter combinations (must all be "ok")
 *   5. Snapshot (what the page reads): age, row count, tier counts vs live, read + aggregate timing
 *   6. Sample clients (highest priority first) with their contributing signals
 */
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { insightClientWhere, runInsightsScan, scanContext, toInsightRow, weekStart } from '@/lib/insights/clinical/load';
import {
  buildPopulationView,
  CARE_GAP_KEYS,
  careGapTileFilters,
  EMPTY_FILTERS,
  filterRows,
  KPI_SIGNALS,
  noFutureTileFilters,
  signalTileFilters,
  sortRows,
  tierTileFilters,
  tileCounts,
  zeroCoverageBanners,
  type InsightFilters,
  type InsightRow,
  type RowHistory,
} from '@/lib/insights/clinical/population';
import { loadInsightRows } from '@/lib/insights/clinical/snapshot';
import { SIGNAL_META } from '@/lib/insights/clinical/rules';
import { TIERS } from '@/lib/insights/clinical/types';

const pad = (s: string | number, n: number) => String(s).padEnd(n);
/** Expected ceiling for Urgent + High + Watch as a share of evaluated clients */
const ATTENTION_TARGET = 0.15;
function table(title: string, header: string[], rows: (string | number)[][]) {
  console.log(`\n=== ${title} ===`);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)) + 2);
  console.log(header.map((h, i) => pad(h, widths[i])).join(''));
  for (const r of rows) console.log(r.map((c, i) => pad(c, widths[i])).join(''));
}
const pctOf = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');

function consistency(rows: InsightRow[], label: string, f: InsightFilters, viewerId: string | null): (string | number)[][] {
  const t = tileCounts(rows, f, viewerId);
  const out: (string | number)[][] = [];
  const check = (tile: string, count: number, list: number) => out.push([label, tile, count, list, count === list ? 'ok' : 'MISMATCH']);
  for (const tier of TIERS) check(`tier:${tier}`, t.tiers[tier], filterRows(rows, tierTileFilters(f, tier), viewerId).length);
  for (const g of CARE_GAP_KEYS) check(`gap:${g}`, t.careGaps[g], filterRows(rows, careGapTileFilters(f, g), viewerId).length);
  for (const k of KPI_SIGNALS) check(`signal:${k}`, t.signals[k], filterRows(rows, signalTileFilters(f, k), viewerId).length);
  check('noFutureAppt', t.noFutureAppt, filterRows(rows, noFutureTileFilters(f), viewerId).length);
  const sum = TIERS.reduce((s, x) => s + t.tiers[x], 0);
  check('sum(tiers)=total', sum, t.total);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let orgId = args.find((a) => a.startsWith('--org='))?.slice(6) || null;
  const samples = Number(args.find((a) => a.startsWith('--samples='))?.slice(10) || 5);
  if (!orgId) {
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
    if (orgs.length !== 1) {
      console.log('More than one organization; pass --org=<id>:');
      for (const o of orgs) console.log(`  ${o.id}  ${o.name}`);
      return;
    }
    orgId = orgs[0].id;
  }
  const tz = await getPracticeTimeZone(orgId);
  const now = new Date();
  const clientWhere = clientOrgFilter(orgId);

  // 1. Live evaluation
  const t0 = Date.now();
  const ctx = await scanContext({ organizationId: orgId, actor: { userId: 'system', role: 'ADMIN' }, clientWhere, timeZone: tz, now });
  const scan = await runInsightsScan({ ctx, where: insightClientWhere(clientWhere, ctx), lockedIds: async () => new Set<string>() });
  const liveMs = Date.now() - t0;
  const iso = now.toISOString();
  const rows = scan.evaluated.map((e) => toInsightRow(e, iso));
  const histories = new Map<string, RowHistory>(scan.evaluated.map((e) => [e.client.id, e.history]));
  console.log(`Organization ${orgId}  today=${ctx.today} tz=${tz}`);
  console.log(`Live evaluation: ${scan.clientsScanned} clients in ${liveMs} ms (truncated=${scan.truncated}); safety plans linked: ${ctx.safetyPlanIds.size}; recent discharge cases matched: ${ctx.discharges.size}`);
  table('Tiers (live)', ['tier', 'clients', 'share'], TIERS.map((t) => [t, rows.filter((r) => r.tier === t).length, pctOf(rows.filter((r) => r.tier === t).length, rows.length)]));

  const attention = rows.filter((r) => r.tier !== 'stable').length;
  const share = rows.length ? attention / rows.length : 0;
  console.log(`Needs attention (Urgent + High + Watch): ${attention} of ${rows.length} (${pctOf(attention, rows.length)}) — expectation ≤ ${ATTENTION_TARGET * 100}%: ${share <= ATTENTION_TARGET ? 'ok' : 'WARN (review the rules or data quality)'}`);
  const outreach = rows.filter((r) => r.signals.some((x) => x.key === 'not_in_care')).length;
  console.log(`Possibly disengaged / inactive (outreach care gap, not a tier): ${outreach} (${pctOf(outreach, rows.length)})`);
  const levels = new Map<string, number>();
  for (const r of rows) for (const x of r.signals) levels.set(`${x.key}:${x.level}`, (levels.get(`${x.key}:${x.level}`) ?? 0) + 1);
  table('Signals by level (signal instances)', ['signal:level', 'count'], [...levels].sort((a, b) => b[1] - a[1]));
  for (const b of zeroCoverageBanners(rows)) console.log(`0% coverage banner: ${b.text}`);

  // 2. Signals
  const view = buildPopulationView(rows, histories, weekStart(ctx.today), ctx.today.slice(0, 7));
  table('Signals (clients with the signal)', ['signal', 'category', 'clients'],
    (Object.keys(view.signalCounts) as (keyof typeof view.signalCounts)[]).map((k) => [k, SIGNAL_META[k].category, view.signalCounts[k]]).sort((a, b) => Number(b[2]) - Number(a[2])));

  // 3. Coverage
  table('Data coverage', ['source', 'clients', 'share'], view.coverage.map((c) => { const n = rows.filter((r) => r.coverage[c.key]).length; return [c.label, n, pctOf(n, rows.length)]; }));
  const k = view.kpis;
  console.log(`KPIs: worsening ${k.worsening.pct ?? 'n<10'}% of ${k.worsening.den} tracked; improving ${k.improving.pct ?? 'n<10'}%; measurement completion ${k.measurement.pct ?? 'n<10'}% of ${k.measurement.den} seen; no future appointment ${k.noFutureAppt}`);
  for (const s of view.trends.shifts) {
    console.log(`Shift ${s.key}: ${s.period} ${s.shift.now.pct ?? 'n<10'}% (n=${s.shift.now.den}) vs ${s.previous} ${s.shift.prev.pct ?? 'n<10'}% (n=${s.shift.prev.den}) → ${s.shift.reason}${s.shift.z != null ? ` z=${s.shift.z}` : ''}`);
  }

  // 4. Tiles vs lists
  const filterSets: [string, InsightFilters][] = [['all', EMPTY_FILTERS]];
  for (const l of [...new Map(rows.filter((r) => r.location).map((r) => [r.location!.id, r.location!])).values()].slice(0, 4)) filterSets.push([`location:${l.id}`, { ...EMPTY_FILTERS, locationId: l.id }]);
  const topClin = [...new Map(rows.filter((r) => r.clinician).map((r) => [r.clinician!.id, r.clinician!.id])).keys()].slice(0, 2);
  for (const c of topClin) filterSets.push([`myCaseload:${c}`, { ...EMPTY_FILTERS, myCaseload: true }]);
  filterSets.push(['category:safety', { ...EMPTY_FILTERS, category: 'safety' }]);
  const checks: (string | number)[][] = [];
  for (const [label, f] of filterSets) checks.push(...consistency(rows, label, f, label.startsWith('myCaseload:') ? label.slice(11) : null));
  const bad = checks.filter((c) => c[4] !== 'ok');
  table(`Tile vs list consistency (${checks.length} checks, ${bad.length} mismatches)`, ['filters', 'tile', 'tile count', 'list length', 'result'], bad.length ? bad : checks.filter((c) => c[0] === 'all'));
  const worseMetric = rows.filter((r) => r.metrics.worsening).length;
  console.log(`KPI worsening: rate numerator ${worseMetric} vs worsening tile ${tileCounts(rows, EMPTY_FILTERS, null).signals.worsening} → ${worseMetric === tileCounts(rows, EMPTY_FILTERS, null).signals.worsening ? 'ok' : 'MISMATCH'}`);

  // 5. Snapshot
  const s0 = Date.now();
  const read = await loadInsightRows({ organizationId: orgId, clientWhere, lockedIds: async () => new Set<string>() });
  const readMs = Date.now() - s0;
  const a0 = Date.now();
  buildPopulationView(read.rows, read.histories, weekStart(ctx.today), ctx.today.slice(0, 7));
  tileCounts(read.rows, EMPTY_FILTERS, null);
  const aggMs = Date.now() - a0;
  console.log(`\nSnapshot: ${read.rows.length} rows, scanned ${read.scannedAt ?? 'never'}; active clients not in snapshot: ${read.notScanned}; last run ${read.lastRun ? `${read.lastRun.trigger} ${read.lastRun.status} ${read.lastRun.startedAt} (${read.lastRun.durationMs ?? '—'} ms)` : 'none'}`);
  console.log(`Snapshot read ${readMs} ms + aggregate ${aggMs} ms (page target: under 1500 ms cold)`);
  if (read.rows.length) {
    table('Tiers: snapshot vs live', ['tier', 'snapshot', 'live'], TIERS.map((t) => [t, read.rows.filter((r) => r.tier === t).length, rows.filter((r) => r.tier === t).length]));
  } else {
    console.log('No snapshot yet: run scripts/clinical-insights-scan.ts or open the page once.');
  }

  // 6. Samples
  console.log(`\n=== ${samples} sample clients (highest priority first; ids / MRN / signal keys / values / dates only) ===`);
  for (const r of sortRows(rows, 'priority').slice(0, samples)) {
    console.log(`- ${r.id}  MRN ${r.mrn ?? '—'}  tier=${r.tier}  rules=${r.rules.join(',') || '—'}`);
    for (const s of r.signals) console.log(`    ${s.level.padEnd(8)} ${s.key.padEnd(22)} ${s.date ?? '—'}  ${s.label}`);
  }
}

main()
  .catch((err) => {
    console.error('check-clinical-insights failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
