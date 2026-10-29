/**
 * Generate (or regenerate) one client's chart history digest.
 *
 * Usage:
 *   npx tsx scripts/chart-digest.ts --org <organizationId> --client <clientId> [--kind bh|medical]
 *
 * Needs AWS Bedrock credentials. Skips protected records and clients who declined AI use.
 * Nothing is invented: the digest only restates chart records, each with a citation.
 */
import 'dotenv/config';
import { isBedrockConfigured } from '../src/lib/ai/bedrockService';
import { loadDigestFacts } from '../src/lib/chart-digest/access';
import { generateChartDigest } from '../src/lib/chart-digest/build';
import { parseDigestKind } from '../src/lib/chart-digest/kinds';
import { prisma } from '../src/lib/db/prisma';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const organizationId = arg('org');
  const clientId = arg('client');
  const kind = parseDigestKind(arg('kind'));
  if (!organizationId || !clientId || !kind) {
    console.error('Usage: npx tsx scripts/chart-digest.ts --org <organizationId> --client <clientId> [--kind bh|medical]');
    process.exitCode = 1;
    return;
  }
  if (!isBedrockConfigured()) {
    console.error('[chart-digest] AI is not configured (AWS credentials missing).');
    process.exitCode = 1;
    return;
  }

  const facts = await loadDigestFacts({ userId: 'system', role: 'SYSTEM', organizationId }, clientId);
  if (!facts) {
    console.error('[chart-digest] Client not found in that organization.');
    process.exitCode = 1;
    return;
  }
  if (facts.sensitiveRecord) {
    console.error('[chart-digest] Skipped: protected record.');
    process.exitCode = 1;
    return;
  }
  if (facts.aiConsentDeclined) {
    console.error('[chart-digest] Skipped: client declined AI use.');
    process.exitCode = 1;
    return;
  }

  const result = await generateChartDigest({ organizationId, clientId, kind, generatedById: null });
  if (result.ok === false) {
    console.error('[chart-digest] Failed:', result.error);
    process.exitCode = 1;
    return;
  }
  const items = result.digest.content.sections.reduce((n, s) => n + s.items.length, 0);
  console.log(JSON.stringify({ ok: true, kind, generatedAt: result.digest.generatedAt, items }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
