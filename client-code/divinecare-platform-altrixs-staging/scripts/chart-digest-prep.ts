/**
 * Nightly chart-history prep: generates missing / stale chart history digests for clients with a
 * visit tomorrow, so the pre-visit brief has cited history before the visit. Run by cron (NOT
 * INSTALLED: install only after owner approval, see deploy/crontab.staging):
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/chart-digest-prep.ts             (dry run: counts only)
 *   npx tsx --conditions=react-server --env-file=.env scripts/chart-digest-prep.ts --apply     (generate)
 *
 * Options: --dates=tomorrow (default; the evening run) | today (the morning top-up: today's visits,
 * only clients without a current digest), --days=N (evening: visits in the next N practice days,
 * default 1 = tomorrow), --concurrency=N
 * (clients in flight, default 4; each client's chunk calls are bounded too, with Bedrock throttling
 * retried with backoff), --max-cost=DOLLARS (per-run budget, default 75; no new client starts once
 * the cap would be reached), --max-clients=N (default 200), --org=<id> or DEFAULT_ORG=<id>.
 *
 * Selection (src/lib/ai/chartDigest/prep.ts): scheduled visits in the window across all clinicians
 * (practice time zone); kind by visit (primary-care visit → medical digest for primary-care
 * patients, otherwise the BH digest); only digests that are missing or stale (source hash changed,
 * failed, text pending). AI consent declined / not configured are skipped by buildChartDigest.
 * Prints counts and costs only (never names or ids). One audit row per organization run
 * (chart_digest_prep_run, counts only). Holds pg_try_advisory_lock(hashtext('job:chart-digest-prep')).
 * Setting CHART_DIGEST_NIGHTLY_PREP=on (with the cron line) makes the chart history card say
 * "Chart history will be prepared before the next visit".
 * Huddle notice: after each organization's evening run (--dates=tomorrow --apply), with
 * HUDDLE_EMAIL_NOTICE=on, each provider with visits tomorrow gets "Your summary for tomorrow
 * (N visits) is ready" (counts and a link only; src/lib/huddle/notice.ts).
 *
 * Proposed cron (UTC; NOT INSTALLED):
 *   0 22 * * *  evening (6 PM EDT):  ... scripts/chart-digest-prep.ts --apply --dates=tomorrow
 *   0 9 * * *   morning (5 AM EDT):  ... scripts/chart-digest-prep.ts --apply --dates=today
 */
import { prisma } from '@/lib/db/prisma';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { latestChartDigest, loadDigestSources, prismaChartDigestDeps } from '@/lib/ai/chartDigest/store';
import { buildChartDigest, computeSourceHash, digestStaleness, selectSources } from '@/lib/ai/chartDigest/service';
import { buildMedicalDigest, computeMedicalSourceHash, selectMedicalSources } from '@/lib/ai/chartDigest/medical/service';
import { isPrimaryCareClient, loadMedicalDigestSources, prismaMedicalDigestDeps } from '@/lib/ai/chartDigest/medical/store';
import { formatPrepSummary, needingPrep, parsePrepArgs, prepWindow, runPrep, selectPrepTargets, type DigestFreshness, type PrepOutcome, type PrepTarget } from '@/lib/ai/chartDigest/prep';
import { sendHuddleNotices } from '@/lib/huddle/notice';

const args = parsePrepArgs(process.argv.slice(2), process.env);
const LABEL = 'scripts/chart-digest-prep.ts';

async function freshness(org: string, t: PrepTarget): Promise<DigestFreshness> {
  const stored = await latestChartDigest(org, t.clientId, t.kind);
  if (!stored) return 'missing';
  const hash =
    t.kind === 'medical'
      ? computeMedicalSourceHash(selectMedicalSources(await loadMedicalDigestSources(org, t.clientId)).selected)
      : computeSourceHash(selectSources(await loadDigestSources(org, t.clientId)).selected);
  return digestStaleness(stored, hash).stale ? 'stale' : 'fresh';
}

async function runOrg(org: string) {
  const started = Date.now();
  const timeZone = await getPracticeTimeZone(org);
  const window = prepWindow(new Date(), timeZone, args.days, args.dates === 'today' ? 0 : 1);
  const appts = await prisma.appointment.findMany({
    where: { client: { organizationId: org }, startsAt: { gte: window.from, lt: window.to }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
    select: { clientId: true, startsAt: true, type: true, status: true, notes: true, clinician: { select: { role: true } } },
    take: 5000,
  });
  let targets = selectPrepTargets(
    appts.map((a) => ({ clientId: a.clientId, startsAt: a.startsAt, type: a.type, status: String(a.status), notes: a.notes, clinicianRole: a.clinician?.role ? String(a.clinician.role) : null })),
    window
  );
  // Medical digests are for primary-care patients only
  const medicalOk = new Map<string, boolean>();
  for (const t of targets) if (t.kind === 'medical' && !medicalOk.has(t.clientId)) medicalOk.set(t.clientId, await isPrimaryCareClient(org, t.clientId).catch(() => false));
  targets = targets.filter((t) => t.kind === 'bh' || medicalOk.get(t.clientId));
  const todo = await needingPrep(targets, (t) => freshness(org, t));

  const header = { org, run: args.dates, days: args.days, dates: window.dates.join('..'), visits: appts.length, targets: targets.length, staleOrMissing: todo.length };
  if (!args.apply) {
    console.log(`chart-digest-prep DRY RUN ${Object.entries(header).map(([k, v]) => `${k}=${v}`).join(' ')} (no AI calls, nothing written)`);
    return;
  }

  // Each client's chunk calls share the Bedrock quota with the other clients in flight
  const chunkConcurrency = Math.max(1, Math.floor(8 / args.concurrency));
  const bhDeps = { ...prismaChartDigestDeps({ gate: null, path: 'script:chart-digest-prep', scriptLabel: LABEL, organizationId: org }), chunkConcurrency };
  const medicalDeps = { ...prismaMedicalDigestDeps({ gate: null, path: 'script:chart-digest-prep', scriptLabel: LABEL, organizationId: org }), chunkConcurrency };
  const summary = await runPrep({
    targets: todo,
    concurrency: args.concurrency,
    maxCostUsd: args.maxCostUsd,
    maxClients: args.maxClients,
    async generate(t): Promise<PrepOutcome> {
      const r =
        t.kind === 'medical'
          ? await buildMedicalDigest(medicalDeps, { organizationId: org, clientId: t.clientId, actorId: null, allowOcr: true })
          : await buildChartDigest(bhDeps, { organizationId: org, clientId: t.clientId, actorId: null, allowOcr: true });
      if (r.ok === false) return { status: 'not_generated', costUsd: 0, reason: r.reason };
      if (r.skipped) return { status: 'up_to_date', costUsd: 0 };
      return { status: r.summary.status === 'failed' ? 'failed' : 'generated', costUsd: r.summary.costEstimateUsd, reason: r.summary.status === 'failed' ? 'generation_failed' : undefined };
    },
  });
  const line = formatPrepSummary(summary, { org, dates: window.dates.join('..'), maxCost: args.maxCostUsd, concurrency: args.concurrency, durationMs: Date.now() - started });
  console.log(`chart-digest-prep ${line}`);
  // One run record per organization (counts and dollars only)
  await writeAuditLog({
    action: 'chart_digest_prep_run',
    actorUserId: null,
    actorRole: 'system',
    organizationId: org,
    resourceType: 'chartDigest',
    outcome: summary.failed && !summary.generated ? 'FAILURE' : 'SUCCESS',
    userAgent: LABEL,
    metadata: { ...header, ...summary, maxCostUsd: args.maxCostUsd, maxClients: args.maxClients, concurrency: args.concurrency, durationMs: Date.now() - started },
  });
  // Evening run only: tell each provider tomorrow's huddle is ready (HUDDLE_EMAIL_NOTICE=on; counts only)
  if (args.dates === 'tomorrow') {
    const notice = await sendHuddleNotices({ organizationId: org, date: window.dates[0], label: LABEL }).catch(() => null);
    if (notice?.enabled) console.log(`huddle-notice org=${org} providers=${notice.providers} sent=${notice.sent} optedOut=${notice.optedOut} noEmail=${notice.noEmail} failed=${notice.failed}`);
  }
}

async function main() {
  const orgs = await prisma.organization.findMany({ where: args.org ? { id: args.org } : { active: true }, select: { id: true } });
  const lock = await withJobLock(JOB_LOCK_KEYS.chartDigestPrep, async () => {
    for (const o of orgs) {
      try {
        await runOrg(o.id);
      } catch (err) {
        // Error class only: messages can carry query text
        console.error(`chart-digest-prep org=${o.id} failed: ${err instanceof Error ? err.name : 'unknown'}`);
        process.exitCode = 1;
      }
    }
  });
  if (!lock.acquired) console.log('chart-digest-prep: already running');
}

main()
  .catch((err) => {
    console.error('chart-digest-prep failed:', err instanceof Error ? err.name : 'unknown');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
