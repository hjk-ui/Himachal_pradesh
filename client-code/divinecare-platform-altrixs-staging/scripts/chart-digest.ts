/**
 * Chart history digest: pilot tooling. Prints ids, counts and cost estimates only (never names,
 * document titles or chart text).
 *
 *   npx tsx scripts/chart-digest.ts --org=<orgId> [--client=<id>]... [--limit=N]          (dry run)
 *   npx tsx scripts/chart-digest.ts --org=<orgId> --client=<id> --apply [--force] [--ocr-wait=10]
 *   npx tsx scripts/chart-digest.ts --org=<orgId> --estimate-all [--sample=N]
 *   any of the above with --kind=bh (default) | medical | auto
 *
 * --kind: bh = behavioral health digest; medical = primary-care digest (primary-care patients only:
 *   Family Practice documents, labs, imaging, consult letters, signed medical visits); auto = by
 *   patient type (primary care -> medical, behavioral health -> bh, both -> both).
 *
 * --dry-run (default): per client, counts clinical sources / pages / text-layer vs scanned pages
 *   (read locally; no AWS) and the estimated Bedrock + Textract cost. No AI calls, no writes.
 * --apply: generates digests for the selected clients only (requires --client or --limit ≤ 25):
 *   extracts text (Textract for scanned pages, waiting up to --ocr-wait minutes), then one
 *   incremental digest run per client. Audited as SYSTEM (via scripts/chart-digest.ts).
 * --estimate-all: the dry-run estimate for every client in the org with chart sources
 *   (--sample=N inspects N clients and extrapolates to the roster).
 * Without --client, clients are those with filed documents or signed notes, in id order.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { withIntegrationCall } from '@/lib/integrations/callLog/record';
import { DOC_SELECT, extractDeps, loadDigestSources, prismaChartDigestDeps } from '@/lib/ai/chartDigest/store';
import { buildChartDigest, noteText, selectSources } from '@/lib/ai/chartDigest/service';
import { estimateClient, extrapolate, sumEstimates, ASSUMED_CHARS_PER_PAGE, digestPrices, type ClientEstimate, type EstimateSource } from '@/lib/ai/chartDigest/cost';
import { inspectPdfText, isImage, isPdf, storedPages } from '@/lib/ai/chartDigest/extract';
import { kindsForScript, parseScriptKind, type DigestKind } from '@/lib/ai/chartDigest/access';
import { buildMedicalDigest, selectMedicalSources, visitText } from '@/lib/ai/chartDigest/medical/service';
import { hasBehavioralChart, isPrimaryCareClient, loadMedicalDigestSources, prismaMedicalDigestDeps } from '@/lib/ai/chartDigest/medical/store';
import { primaryCarePatientWhere } from '@/lib/medical/medicalProgram';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const values = (name: string) => argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3)).filter(Boolean);
const value = (name: string) => values(name)[0];

const org = value('org');
const clientIds = values('client');
const limit = value('limit') ? Math.max(1, Number.parseInt(value('limit')!, 10) || 1) : null;
const apply = flag('apply');
const estimateAll = flag('estimate-all');
const force = flag('force');
const sample = value('sample') ? Math.max(1, Number.parseInt(value('sample')!, 10) || 1) : null;
const ocrWaitMs = Math.max(0, Number(value('ocr-wait') ?? 10)) * 60_000;
const APPLY_MAX = 25;
const kindArg = parseScriptKind(value('kind'));

function usage(msg: string): never {
  console.error(msg);
  console.error('Usage: npx tsx scripts/chart-digest.ts --org=<orgId> [--client=<id>]... [--limit=N] [--kind=bh|medical|auto] [--dry-run | --apply [--force] [--ocr-wait=MIN] | --estimate-all [--sample=N]]');
  process.exit(1);
}

const usd = (n: number) => `$${n.toFixed(4)}`;
const line = (label: string, e: ClientEstimate) =>
  `${label}  docs=${e.documents} pages=${e.pages} text=${e.textPages} scanned=${e.scannedPages} chunks=${e.chunks} tokensIn≈${e.tokensIn} tokensOut≈${e.tokensOut} bedrock≈${usd(e.bedrockUsd)} textract≈${usd(e.textractUsd)} total≈${usd(e.totalUsd)}`;

/** Clients with chart sources for the chosen kind (medical: primary-care patients with documents or signed visits) */
function rosterWhere(): Prisma.ClientWhereInput {
  const bh: Prisma.ClientWhereInput = { OR: [{ documentIntakes: { some: { status: 'filed', voidedAt: null } } }, { progressNotes: { some: { workflow: { status: { in: ['SIGNED', 'LOCKED'] } } } } }] };
  const medical: Prisma.ClientWhereInput = { AND: [primaryCarePatientWhere(), { OR: [{ documentIntakes: { some: { status: 'filed', voidedAt: null } } }, { medicalVisits: { some: { signedAt: { not: null } } } }] }] };
  if (kindArg === 'medical') return { organizationId: org!, ...medical };
  if (kindArg === 'auto') return { organizationId: org!, OR: [bh, medical] };
  return { organizationId: org!, ...bh };
}

/** Kinds to process for one client (--kind; auto = by patient type) */
async function kindsFor(clientId: string): Promise<DigestKind[]> {
  if (kindArg === 'bh') return ['bh'];
  const [primaryCare, behavioral] = await Promise.all([isPrimaryCareClient(org!, clientId), hasBehavioralChart(org!, clientId)]);
  return kindsForScript(kindArg!, { primaryCare, behavioral });
}

async function selectClients(): Promise<string[]> {
  if (clientIds.length) {
    const rows = await prisma.client.findMany({ where: { id: { in: clientIds }, organizationId: org! }, select: { id: true } });
    const found = new Set(rows.map((r) => r.id));
    for (const id of clientIds) if (!found.has(id)) console.log(`client ${id}: not in this organization (skipped)`);
    return clientIds.filter((id) => found.has(id));
  }
  const rows = await prisma.client.findMany({
    where: rosterWhere(),
    select: { id: true },
    orderBy: { id: 'asc' },
    ...(estimateAll && !sample ? {} : { take: estimateAll ? sample! : limit ?? 5 }),
  });
  return rows.map((r) => r.id);
}

/** Local-only sizing of one client's selected sources (no AWS, no writes) */
async function estimateFor(clientId: string, kind: DigestKind): Promise<{ est: ClientEstimate; excluded: Record<string, number>; part2: number }> {
  type Sel = { key: string; date: string; version: string; id: string; part2: boolean; noteChars?: number; isDoc: boolean };
  let selected: Sel[];
  let excluded: Record<string, number>;
  if (kind === 'medical') {
    // Medical documents (Family Practice notes, labs, imaging, consult letters...) + signed visits
    const r = selectMedicalSources(await loadMedicalDigestSources(org!, clientId));
    selected = r.selected.map((s) => ({ key: s.key, date: s.date, version: s.version, id: s.id, part2: s.part2, isDoc: Boolean(s.doc), noteChars: s.visit ? visitText(s.visit).length : undefined }));
    excluded = r.excluded;
  } else {
    const r = selectSources(await loadDigestSources(org!, clientId, { withBodies: true }));
    selected = r.selected.map((s) => ({ key: s.key, date: s.date, version: s.version, id: s.id, part2: s.part2, isDoc: Boolean(s.doc), noteChars: s.note ? noteText(s.note.body).length : undefined }));
    excluded = r.excluded;
  }
  const sources: EstimateSource[] = [];
  for (const s of selected) {
    if (!s.isDoc) {
      sources.push({ key: s.key, date: s.date, version: s.version, pageCount: 1, pageChars: [s.noteChars ?? 0], scannedPages: 0 });
      continue;
    }
    const doc = await prisma.documentIntake.findUnique({ where: { id: s.id }, select: DOC_SELECT });
    if (!doc) continue;
    const cached = storedPages(doc.pageTexts);
    if (cached && cached.some((p) => p.trim())) {
      sources.push({ key: s.key, date: s.date, version: s.version, pageCount: cached.length, pageChars: cached.map((p) => p.length), scannedPages: 0 });
      continue;
    }
    const bytes = await extractDeps.readFile(doc.s3RawKey).catch(() => null);
    if (bytes && isPdf(doc)) {
      try {
        const r = await inspectPdfText(extractDeps, bytes);
        // Scanned pages will be OCR'd, then sent to Bedrock: count them at the assumed page size
        sources.push({ key: s.key, date: s.date, version: s.version, pageCount: r.pageCount, pageChars: r.pageChars.map((c) => c || ASSUMED_CHARS_PER_PAGE), scannedPages: r.scannedPages });
        continue;
      } catch {
        /* unreadable PDF: fall through to the page-count estimate */
      }
    }
    const pages = isImage(doc) ? 1 : Math.max(1, doc.pageCount ?? 1);
    sources.push({ key: s.key, date: s.date, version: s.version, pageCount: pages, pageChars: null, scannedPages: bytes && isImage(doc) ? 1 : 0 });
  }
  return { est: estimateClient(sources), excluded, part2: selected.filter((s) => s.part2).length };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extract text for every selected document, waiting for Textract jobs up to ocrWaitMs */
async function prepareText(clientId: string, kind: DigestKind): Promise<{ ready: number; pending: number; unavailable: number }> {
  const deps = prismaChartDigestDeps({ gate: null, path: 'script:chart-digest', scriptLabel: 'scripts/chart-digest.ts', organizationId: org, kind });
  const docs =
    kind === 'medical'
      ? selectMedicalSources(await loadMedicalDigestSources(org!, clientId)).selected.filter((s) => s.doc).map((s) => s.doc!)
      : selectSources(await loadDigestSources(org!, clientId)).selected.filter((s) => s.doc).map((s) => s.doc!);
  const deadline = Date.now() + ocrWaitMs;
  let pending = docs;
  let ready = 0;
  let unavailable = 0;
  for (;;) {
    const next: typeof docs = [];
    for (const d of pending) {
      const r = await deps.extract(d, { allowOcr: true });
      if (r.state === 'ready') ready++;
      else if (r.state === 'pending') next.push(d);
      else unavailable++;
    }
    pending = next;
    if (!pending.length || Date.now() >= deadline) break;
    await sleep(20_000);
  }
  return { ready, pending: pending.length, unavailable };
}

async function main() {
  if (!org) usage('--org is required');
  if (!kindArg) usage('--kind must be bh, medical or auto');
  if (apply && estimateAll) usage('--apply and --estimate-all cannot be combined');
  if (apply && !clientIds.length && !limit) usage(`--apply needs --client=<id> or --limit=N (N ≤ ${APPLY_MAX}); the full run waits for the owner's go-ahead`);
  if (apply && (limit ?? clientIds.length) > APPLY_MAX) usage(`--apply is limited to ${APPLY_MAX} clients per run`);
  const orgRow = await prisma.organization.findUnique({ where: { id: org }, select: { id: true } });
  if (!orgRow) usage('organization not found');

  const ids = await selectClients();
  const p = digestPrices();
  console.log(`mode=${apply ? 'apply' : estimateAll ? 'estimate-all' : 'dry-run'} kind=${kindArg} clients=${ids.length} prices: in $${p.inPerM}/M out $${p.outPerM}/M textract $${p.textractPerPage}/page`);

  if (!apply) {
    const all: ClientEstimate[] = [];
    let i = 0;
    for (const id of ids) {
      i++;
      for (const kind of await kindsFor(id)) {
        const { est, excluded, part2 } = await estimateFor(id, kind);
        all.push(est);
        const ex = Object.entries(excluded).map(([k, v]) => `${k}=${v}`).join(' ');
        if (!estimateAll || ids.length <= 50) console.log(line(`[${i}] client ${id} kind=${kind}`, est) + (part2 ? ` part2Included=${part2}` : '') + (ex ? ` excluded: ${ex}` : ''));
      }
    }
    console.log(line('TOTAL (selected)', sumEstimates(all)));
    if (estimateAll && sample) {
      const roster = await prisma.client.count({ where: rosterWhere() });
      console.log(line(`ESTIMATE (roster of ${roster}, from a sample of ${ids.length})`, extrapolate(all, roster)));
    }
    console.log('No AI calls were made and nothing was written.');
    return;
  }

  const bhDeps = prismaChartDigestDeps({ gate: null, path: 'script:chart-digest', scriptLabel: 'scripts/chart-digest.ts', organizationId: org });
  const medicalDeps = prismaMedicalDigestDeps({ gate: null, path: 'script:chart-digest', scriptLabel: 'scripts/chart-digest.ts', organizationId: org });
  let spent = 0;
  let i = 0;
  for (const id of ids) {
    i++;
    for (const kind of await kindsFor(id)) {
      const text = await prepareText(id, kind);
      const r =
        kind === 'medical'
          ? await buildMedicalDigest(medicalDeps, { organizationId: org!, clientId: id, actorId: null, allowOcr: true, force })
          : await buildChartDigest(bhDeps, { organizationId: org!, clientId: id, actorId: null, allowOcr: true, force });
      if (r.ok === false) {
        console.log(`[${i}] client ${id} kind=${kind}: not generated (${r.reason})`);
        continue;
      }
      const s = r.summary;
      spent += s.costEstimateUsd;
      const counts = Object.entries(s.counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');
      console.log(
        `[${i}] client ${id} kind=${kind}: ${r.skipped ? 'up to date (skipped)' : `v${s.version} ${s.status}`} sources=${s.sources} part2=${s.part2Sources} textReady=${text.ready} textPending=${text.pending} textUnavailable=${text.unavailable} ` +
          `chunks=${s.chunks} reused=${s.chunksReused} calls=${s.modelCalls} failed=${s.failedCalls} kept=${s.factsKept} dropped=${Object.values(s.drops).reduce((a, b) => a + b, 0)} ` +
          `tokensIn=${s.tokensIn} tokensOut=${s.tokensOut} cost≈${usd(s.costEstimateUsd)}${counts ? ` | ${counts}` : ''}`
      );
    }
  }
  console.log(`Bedrock cost this run ≈ ${usd(spent)}`);
}

withIntegrationCall({ integration: 'cron', operation: 'chart-digest', direction: 'job' }, main)
  .catch((err) => {
    // Error class only: messages can carry query text
    console.error('chart-digest failed:', err instanceof Error ? err.name : 'unknown');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
