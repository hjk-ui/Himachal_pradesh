/**
 * Prepare chart history digests ahead of upcoming visits.
 *
 * Dry run by default: lists who would be prepared. Nothing is generated without --apply.
 *
 * Usage:
 *   npx tsx scripts/chart-digest-prep.ts                      # dry run, next 24 hours
 *   npx tsx scripts/chart-digest-prep.ts --apply              # generate
 *   npx tsx scripts/chart-digest-prep.ts --apply --hours 48
 *   npx tsx scripts/chart-digest-prep.ts --apply --org <organizationId>
 *
 * Scheduling (ops enables later; intentionally not scheduled):
 *   # cron: every day at 05:30 server time
 *   # 30 5 * * * cd /app && npx tsx scripts/chart-digest-prep.ts --apply
 */
import 'dotenv/config';
import { isBedrockConfigured } from '../src/lib/ai/bedrockService';
import { loadDigestFacts } from '../src/lib/chart-digest/access';
import { generateChartDigest, loadStoredDigest } from '../src/lib/chart-digest/build';
import type { ChartDigestKind } from '../src/lib/chart-digest/kinds';
import { prisma } from '../src/lib/db/prisma';
import { resolveVisitKind } from '../src/lib/visits/kinds';

const FRESH_MS = 24 * 60 * 60 * 1000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const organizationId = arg('org');
  const hours = Math.min(Math.max(Number(arg('hours') ?? 24) || 24, 1), 168);

  if (apply && !isBedrockConfigured()) {
    console.error('[chart-digest-prep] AI is not configured (AWS credentials missing). Nothing generated.');
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const until = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const appts = await prisma.appointment.findMany({
    where: {
      startsAt: { gte: now, lte: until },
      status: { in: ['SCHEDULED', 'CHECKED_IN'] },
      organizationId: organizationId ?? { not: null },
    },
    select: { clientId: true, organizationId: true, type: true },
  });

  const summary = { considered: 0, prepared: 0, wouldPrepare: 0, skipped: 0, failed: 0 };
  const seen = new Set<string>();

  for (const a of appts) {
    if (!a.organizationId) continue;
    const kind: ChartDigestKind = resolveVisitKind(a.type) === 'primary_care' ? 'medical' : 'bh';
    const key = `${a.organizationId}:${a.clientId}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    summary.considered++;

    const facts = await loadDigestFacts({ userId: 'system', role: 'SYSTEM', organizationId: a.organizationId }, a.clientId);
    if (!facts || facts.sensitiveRecord || facts.aiConsentDeclined) {
      summary.skipped++;
      continue;
    }
    const stored = await loadStoredDigest(a.organizationId, a.clientId, kind);
    if (stored && now.getTime() - new Date(stored.generatedAt).getTime() < FRESH_MS) {
      summary.skipped++;
      continue;
    }

    if (!apply) {
      summary.wouldPrepare++;
      continue;
    }
    const result = await generateChartDigest({
      organizationId: a.organizationId,
      clientId: a.clientId,
      kind,
      generatedById: null,
    });
    if (result.ok) summary.prepared++;
    else summary.failed++;
  }

  console.log(JSON.stringify({ apply, hours, ...summary }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
