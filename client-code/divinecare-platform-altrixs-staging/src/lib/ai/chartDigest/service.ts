/**
 * Chart history digest orchestration. No prisma / AWS imports: real dependencies come from
 * store.ts, tests pass fakes.
 *
 * Pipeline: select sources (clinical documents + signed notes; psychotherapy notes never; Part 2
 * only with a treatment consent) → extract text (cached; Textract only for scanned pages) →
 * redact the client's names → chunk by month, oldest first → map each changed chunk with Bedrock
 * (Haiku, guard 'clinical', temperature 0) → validate every citation against the source text →
 * deterministic merge → store a new version with the source hash. Unchanged chunks reuse their
 * validated facts from the previous version (incremental), so a new note re-maps one month.
 *
 * Gates (route): view = roles that can request a brief AND read BH chart notes, after the chart
 * gate (org, caseload / care team, Part 2 / VIP lock); generate = licensed BH clinicians on the
 * client's care team, AI consent not declined, Bedrock configured. Every view / generation is
 * audited with ids and counts only.
 */
import { chunkConcurrency, mapLimit, withThrottleRetry } from '@/lib/ai/chartDigest/concurrency';
import { createHash } from 'crypto';
import { redactNames } from '@/lib/ai/previsit/facts';
import { canGenerateChartDigest, canViewChartDigest } from '@/lib/ai/chartDigest/access';
import { chunkSources, renderChunk, sizeOf, sourceAliases } from '@/lib/ai/chartDigest/chunk';
import { classifyChartDocument, decideSource, isPart2Source, isPsychotherapyNoteType } from '@/lib/ai/chartDigest/classify';
import { digestPrices, tokenCost } from '@/lib/ai/chartDigest/cost';
import type { ExtractDoc, ExtractResult } from '@/lib/ai/chartDigest/extract';
import { mergeSections } from '@/lib/ai/chartDigest/merge';
import { CHART_DIGEST_SYSTEM_PROMPT, chartDigestUserPrompt } from '@/lib/ai/chartDigest/prompt';
import {
  CHART_DIGEST_FEATURE,
  CHART_DIGEST_PROMPT_VERSION,
  ITEM_SECTIONS,
  digestCounts,
  type ChartDigest,
  type ChartSource,
  type DigestSections,
} from '@/lib/ai/chartDigest/types';
import { SourceIndex, addDrops, emptyDropCounts, validateMapReply, type DropCounts } from '@/lib/ai/chartDigest/validate';

export type DigestViewer = { organizationId: string; userId: string; role: string };

export type DocRow = ExtractDoc & {
  documentType: string;
  sourcePath: string | null;
  extractedFields: unknown;
  sha256: string | null;
  fileSize: number | null;
  filedAt: Date | null;
  createdAt: Date;
};

export type NoteRow = { id: string; noteType: string | null; body: string; dateOfService: Date | null; createdAt: Date; updatedAt: Date; part2: boolean };

export type SourceSet = { docs: DocRow[]; notes: NoteRow[]; part2Client: boolean; part2ConsentCovers: boolean };

export type StoredDigest = {
  id: string;
  version: number;
  status: 'ready' | 'partial' | 'failed';
  digestJson: unknown;
  sourceDocIds: string[];
  sourceHash: string;
  model: string | null;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
  costEstimateUsd: number;
  generatedAt: Date;
  errors: unknown;
};

export type DigestJson = {
  digest: ChartDigest;
  /** Validated facts per chunk key (reused when a chunk is unchanged) */
  chunkCache: { key: string; sections: DigestSections }[];
  /** Sources whose text was not ready (OCR running / unavailable) */
  pendingSources: string[];
};

export type DigestAudit = { action: 'READ' | 'AI_ACCESS' | 'CREATE'; outcome: 'SUCCESS' | 'DENIED' | 'FAILURE'; clientId: string; metadata: Record<string, unknown> };

export type DigestDeps = {
  resolveAccess(viewer: DigestViewer, clientId: string): Promise<{ ok: true; names: string[]; status?: undefined; reason?: undefined } | { ok: false; status: 403 | 404; reason: string; names?: undefined }>;
  onCareTeam(viewer: DigestViewer, clientId: string): Promise<boolean>;
  aiConsent(organizationId: string, clientId: string): Promise<'signed' | 'missing' | 'declined'>;
  /** withBodies: note bodies (generation only; staleness checks need ids / versions) */
  loadSources(organizationId: string, clientId: string, opts?: { withBodies?: boolean }): Promise<SourceSet>;
  clientNames(organizationId: string, clientId: string): Promise<string[]>;
  extract(doc: ExtractDoc, opts: { allowOcr: boolean }): Promise<ExtractResult>;
  latestDigest(organizationId: string, clientId: string): Promise<StoredDigest | null>;
  saveDigest(row: Omit<StoredDigest, 'id' | 'generatedAt'> & { organizationId: string; clientId: string; generatedById: string | null; generatedAt: Date }): Promise<StoredDigest>;
  bedrockConfigured(): boolean;
  invokeModel(input: { system: string; userPrompt: string }): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
  modelId: string;
  audit(entry: DigestAudit): Promise<void>;
  now?: () => Date;
  /** Chunk calls in flight per client (default CHART_DIGEST_CONCURRENCY or 4) */
  chunkConcurrency?: number;
  /** Backoff sleep for throttling retries (tests pass a no-op) */
  sleep?: (ms: number) => Promise<void>;
};

// ─── Roles ───────────────────────────────────────────────────────────────────

/**
 * View (BH digest): brief roles that read BH chart notes (never HR, billing, front desk, peer
 * support, primary care). Regenerate: licensed BH clinicians (care-team link checked separately).
 * The kind-aware rules live in access.ts (shared with the browser mirror, panelOrder.ts).
 */
export { canViewChartDigest, canGenerateChartDigest } from '@/lib/ai/chartDigest/access';

// ─── Source selection (pure) ─────────────────────────────────────────────────

export type SelectedSource = Omit<ChartSource, 'pages'> & { doc?: DocRow; note?: NoteRow };

function fieldValue(fields: unknown, label: string): string | null {
  if (!Array.isArray(fields)) return null;
  const f = (fields as Array<{ label?: unknown; value?: unknown }>).find((x) => x && x.label === label);
  return typeof f?.value === 'string' ? f.value : null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function selectSources(set: SourceSet): { selected: SelectedSource[]; excluded: Record<string, number> } {
  const excluded: Record<string, number> = {};
  const bump = (r: string) => (excluded[r] = (excluded[r] ?? 0) + 1);
  const selected: SelectedSource[] = [];
  for (const d of set.docs) {
    const title = fieldValue(d.extractedFields, 'Title');
    const folder = fieldValue(d.extractedFields, 'Valant folder');
    const cls = classifyChartDocument({ documentType: d.documentType, fileName: d.fileName, sourcePath: d.sourcePath, title, folder });
    if (cls.include === false) {
      bump(cls.reason);
      continue;
    }
    const part2 = isPart2Source({ kind: 'doc', part2Client: set.part2Client, doc: { documentType: d.documentType, fileName: d.fileName, sourcePath: d.sourcePath, title, folder } });
    const dec = decideSource({ part2, part2ConsentCovers: set.part2ConsentCovers });
    if (!dec.include) {
      bump(dec.reason);
      continue;
    }
    const docDate = fieldValue(d.extractedFields, 'Document date');
    selected.push({
      key: `doc:${d.id}`,
      kind: 'doc',
      id: d.id,
      date: docDate && /^\d{4}-\d{2}-\d{2}$/.test(docDate) ? docDate : ymd(d.filedAt ?? d.createdAt),
      label: String(d.documentType || 'Document').slice(0, 40),
      part2: dec.part2,
      version: d.sha256 || `${d.fileSize ?? 0}:${d.pageCount ?? 0}`,
      doc: d,
    });
  }
  for (const n of set.notes) {
    if (isPsychotherapyNoteType(n.noteType)) {
      bump('psychotherapy_note');
      continue;
    }
    const dec = decideSource({ part2: isPart2Source({ kind: 'note', notePart2: n.part2, part2Client: set.part2Client }), part2ConsentCovers: set.part2ConsentCovers });
    if (!dec.include) {
      bump(dec.reason);
      continue;
    }
    selected.push({
      key: `note:${n.id}`,
      kind: 'note',
      id: n.id,
      date: ymd(n.dateOfService ?? n.createdAt),
      label: String(n.noteType || 'Progress Note').slice(0, 40),
      part2: dec.part2,
      version: n.updatedAt.toISOString(),
      note: n,
    });
  }
  return { selected, excluded };
}

/** Changes whenever a source is added / removed / changed, Part 2 inclusion changes, or the prompt changes */
export function computeSourceHash(selected: Array<Pick<SelectedSource, 'key' | 'version' | 'part2'>>, promptVersion = CHART_DIGEST_PROMPT_VERSION): string {
  const h = createHash('sha256').update(promptVersion);
  for (const s of [...selected].sort((a, b) => (a.key < b.key ? -1 : 1))) h.update(`|${s.key}@${s.version}${s.part2 ? ':p2' : ''}`);
  return h.digest('hex');
}

/** Plain text of a native note body (hidden metadata comments and markup dropped) */
export function noteText(body: string): string {
  return String(body ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseDigestJson(v: unknown): DigestJson | null {
  if (!v || typeof v !== 'object') return null;
  const j = v as Partial<DigestJson>;
  if (!j.digest || typeof j.digest !== 'object') return null;
  return { digest: j.digest as ChartDigest, chunkCache: Array.isArray(j.chunkCache) ? j.chunkCache : [], pendingSources: Array.isArray(j.pendingSources) ? j.pendingSources : [] };
}

/** Stale when the sources changed (hash) or text for some sources was still pending */
export function digestStaleness(stored: Pick<StoredDigest, 'sourceHash' | 'status' | 'digestJson'> | null, currentHash: string): { stale: boolean; reason: 'none' | 'never_generated' | 'sources_changed' | 'pending_text' | 'failed' } {
  if (!stored) return { stale: true, reason: 'never_generated' };
  if (stored.sourceHash !== currentHash) return { stale: true, reason: 'sources_changed' };
  if (stored.status === 'failed') return { stale: true, reason: 'failed' };
  if (stored.status === 'partial' && (parseDigestJson(stored.digestJson)?.pendingSources.length ?? 0) > 0) return { stale: true, reason: 'pending_text' };
  return { stale: false, reason: 'none' };
}

/** Drop Part 2 facts (consent revoked since generation, or a consumer that never shows Part 2) */
export function withoutPart2(d: ChartDigest): ChartDigest {
  const out = { ...d } as ChartDigest;
  for (const s of ITEM_SECTIONS) out[s] = d[s].filter((i) => !i.part2);
  out.medicationTrials = d.medicationTrials.filter((t) => !t.part2);
  out.lastRiskAssessment = d.lastRiskAssessment?.part2 ? null : d.lastRiskAssessment;
  out.safetyPlan = d.safetyPlan?.part2 ? null : d.safetyPlan;
  out.sources = Object.fromEntries(Object.entries(d.sources).filter(([, v]) => !v.part2));
  out.hasPart2 = false;
  return out;
}

// ─── Generation ──────────────────────────────────────────────────────────────

export type GenerateSummary = {
  version: number;
  status: StoredDigest['status'];
  sources: number;
  excluded: Record<string, number>;
  part2Sources: number;
  pendingSources: number;
  unavailableSources: number;
  ocrStarted: number;
  chunks: number;
  chunksReused: number;
  modelCalls: number;
  failedCalls: number;
  truncatedChunks: number;
  factsKept: number;
  drops: DropCounts;
  tokensIn: number;
  tokensOut: number;
  costEstimateUsd: number;
  counts: Record<string, number>;
};

export type GenerateResult =
  | { ok: true; digest: StoredDigest; summary: GenerateSummary; skipped: boolean; status?: undefined; reason?: undefined }
  | { ok: false; status: 403 | 404 | 409 | 503; reason: string; digest?: undefined; summary?: undefined; skipped?: undefined };

/**
 * Build (or incrementally rebuild) the digest for one client. Callers have already gated the actor
 * (route: generateForViewer; script: operator with --apply). `force` regenerates even when fresh.
 */
export async function buildChartDigest(
  deps: DigestDeps,
  input: { organizationId: string; clientId: string; actorId: string | null; allowOcr: boolean; force?: boolean }
): Promise<GenerateResult> {
  const now = (deps.now ?? (() => new Date()))();
  const { organizationId: org, clientId } = input;
  if ((await deps.aiConsent(org, clientId)) === 'declined') return { ok: false, status: 409, reason: 'ai_consent_declined' };
  if (!deps.bedrockConfigured()) return { ok: false, status: 503, reason: 'ai_not_configured' };

  const set = await deps.loadSources(org, clientId, { withBodies: true });
  const { selected, excluded } = selectSources(set);
  const sourceHash = computeSourceHash(selected);
  const prev = await deps.latestDigest(org, clientId);
  const fresh = digestStaleness(prev, sourceHash);
  if (prev && !fresh.stale && !input.force) {
    const prevJson = parseDigestJson(prev.digestJson);
    return { ok: true, digest: prev, skipped: true, summary: emptySummary(prev, excluded, prevJson ? digestCounts(prevJson.digest) : {}) };
  }

  const names = await deps.clientNames(org, clientId);
  const sources: ChartSource[] = [];
  const pending: string[] = [];
  let unavailable = 0;
  let ocrStarted = 0;
  for (const s of selected) {
    let pages: string[] = [];
    if (s.note) pages = [noteText(s.note.body)];
    else if (s.doc) {
      const r = await deps.extract(s.doc, { allowOcr: input.allowOcr });
      if (r.state === 'ready') {
        pages = r.pages;
        // Text-layer pages only (OCR off / not configured): usable, but the scanned pages are missing
        if (r.scannedPages && r.method === 'pdf_text') unavailable++;
      } else if (r.state === 'pending') {
        pending.push(s.key);
        if (r.ocrStarted) ocrStarted++;
      } else unavailable++;
    }
    const redacted = pages.map((p) => (p.trim() ? redactNames(p, names) : ''));
    if (!redacted.some((p) => p.trim())) continue;
    sources.push({ key: s.key, kind: s.kind, id: s.id, date: s.date, label: s.label, part2: s.part2, version: s.version, pages: redacted });
  }

  const byKey = new Map(sources.map((s) => [s.key, s]));
  const { chunks, truncated } = chunkSources(sources.map(sizeOf));
  const aliases = sourceAliases(sources);
  const aliasToKey = new Map([...aliases].map(([k, a]) => [a, k]));
  const index = new SourceIndex(new Map(sources.map((s) => [s.key, { key: s.key, date: s.date, pages: s.pages }])));
  const part2Keys = new Set(sources.filter((s) => s.part2).map((s) => s.key));
  const prevJson = prev && prev.promptVersion === CHART_DIGEST_PROMPT_VERSION && prev.model === deps.modelId ? parseDigestJson(prev.digestJson) : null;
  const cache = new Map((prevJson?.chunkCache ?? []).map((c) => [c.key, c.sections]));

  const chunkCache: DigestJson['chunkCache'] = [];
  let drops = emptyDropCounts();
  let tokensIn = 0;
  let tokensOut = 0;
  let calls = 0;
  let failed = 0;
  let reused = 0;
  let kept = 0;
  const errors: string[] = [];
  // Chunk calls run concurrently (bounded; Bedrock throttling retried with backoff); results are
  // folded back in chunk order so the merge stays chronological.
  const results = await mapLimit(chunks, deps.chunkConcurrency ?? chunkConcurrency(), async (chunk) => {
    const hit = cache.get(chunk.key);
    if (hit) return { state: 'reused' as const, key: chunk.key, sections: hit };
    try {
      const text = renderChunk(chunk, byKey, aliases, (s, n) => s.pages[n - 1] ?? '');
      const reply = await withThrottleRetry(() => deps.invokeModel({ system: CHART_DIGEST_SYSTEM_PROMPT, userPrompt: chartDigestUserPrompt(text) }), { sleep: deps.sleep });
      const v = validateMapReply(reply.text, aliasToKey, index, part2Keys);
      return { state: 'mapped' as const, key: chunk.key, sections: v.sections, drops: v.drops, kept: v.kept, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut };
    } catch (err) {
      return { state: 'failed' as const, error: err instanceof Error ? err.name : 'unknown' };
    }
  });
  for (const r of results) {
    if (r.state === 'reused') {
      reused++;
      chunkCache.push({ key: r.key, sections: r.sections });
      continue;
    }
    calls++;
    if (r.state === 'failed') {
      failed++;
      errors.push(r.error);
      continue;
    }
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    drops = addDrops(drops, r.drops);
    kept += r.kept;
    chunkCache.push({ key: r.key, sections: r.sections });
  }

  const sourceMeta: ChartDigest['sources'] = {};
  for (const s of sources) sourceMeta[s.key] = { date: s.date, label: s.label, part2: s.part2, pageCount: s.pages.length };
  const digest = mergeSections(chunkCache.map((c) => c.sections), sourceMeta);
  const counts = digestCounts(digest);
  const allFailed = failed > 0 && failed === calls && reused === 0;
  const status: StoredDigest['status'] = allFailed ? 'failed' : failed || pending.length || truncated || unavailable ? 'partial' : 'ready';
  const costEstimateUsd = Math.round(tokenCost(tokensIn, tokensOut, digestPrices()) * 10_000) / 10_000;
  const errorList = [
    ...(failed ? [{ code: 'map_failed', count: failed, kinds: [...new Set(errors)].slice(0, 5) }] : []),
    ...(pending.length ? [{ code: 'text_pending', count: pending.length }] : []),
    ...(unavailable ? [{ code: 'text_unavailable', count: unavailable }] : []),
    ...(truncated ? [{ code: 'truncated_oldest_chunks', count: truncated }] : []),
  ];
  const json: DigestJson = { digest, chunkCache, pendingSources: pending };
  const saved = await deps.saveDigest({
    organizationId: org,
    clientId,
    version: (prev?.version ?? 0) + 1,
    status,
    digestJson: json,
    sourceDocIds: selected.map((s) => s.key),
    sourceHash,
    model: deps.modelId,
    promptVersion: CHART_DIGEST_PROMPT_VERSION,
    tokensIn,
    tokensOut,
    costEstimateUsd,
    generatedById: input.actorId,
    generatedAt: now,
    errors: errorList,
  });
  const summary: GenerateSummary = {
    version: saved.version,
    status,
    sources: sources.length,
    excluded,
    part2Sources: part2Keys.size,
    pendingSources: pending.length,
    unavailableSources: unavailable,
    ocrStarted,
    chunks: chunks.length,
    chunksReused: reused,
    modelCalls: calls,
    failedCalls: failed,
    truncatedChunks: truncated,
    factsKept: kept,
    drops,
    tokensIn,
    tokensOut,
    costEstimateUsd,
    counts,
  };
  await deps.audit({ action: 'AI_ACCESS', outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS', clientId, metadata: { feature: CHART_DIGEST_FEATURE, model: deps.modelId, promptVersion: CHART_DIGEST_PROMPT_VERSION, ...summary } });
  return { ok: true, digest: saved, summary, skipped: false };
}

function emptySummary(prev: StoredDigest, excluded: Record<string, number>, counts: Record<string, number>): GenerateSummary {
  return {
    version: prev.version,
    status: prev.status,
    sources: prev.sourceDocIds.length,
    excluded,
    part2Sources: 0,
    pendingSources: 0,
    unavailableSources: 0,
    ocrStarted: 0,
    chunks: 0,
    chunksReused: 0,
    modelCalls: 0,
    failedCalls: 0,
    truncatedChunks: 0,
    factsKept: 0,
    drops: emptyDropCounts(),
    tokensIn: 0,
    tokensOut: 0,
    costEstimateUsd: 0,
    counts,
  };
}

// ─── Viewer entry points (route) ─────────────────────────────────────────────

export type DigestView = {
  clientId: string;
  digest: ChartDigest | null;
  version: number | null;
  status: StoredDigest['status'] | null;
  generatedAt: string | null;
  model: string | null;
  stale: boolean;
  staleReason: ReturnType<typeof digestStaleness>['reason'];
  canRegenerate: boolean;
  part2Withheld: boolean;
};

export type ViewResult = { ok: true; view: DigestView; status?: undefined; reason?: undefined } | { ok: false; status: 403 | 404; reason: string; view?: undefined };

async function gate(deps: DigestDeps, viewer: DigestViewer, clientId: string, action: 'READ' | 'AI_ACCESS'): Promise<{ ok: true } | { ok: false; status: 403 | 404; reason: string }> {
  const base = { feature: CHART_DIGEST_FEATURE };
  if (!canViewChartDigest(viewer.role)) {
    await deps.audit({ action, outcome: 'DENIED', clientId, metadata: { ...base, reason: 'role_not_permitted' } });
    return { ok: false, status: 403, reason: 'role_not_permitted' };
  }
  const access = await deps.resolveAccess(viewer, clientId);
  if (access.ok === false) {
    await deps.audit({ action, outcome: 'DENIED', clientId, metadata: { ...base, reason: access.reason } });
    return { ok: false, status: access.status, reason: access.reason };
  }
  return { ok: true };
}

export async function viewChartDigest(deps: DigestDeps, viewer: DigestViewer, clientId: string): Promise<ViewResult> {
  const g = await gate(deps, viewer, clientId, 'READ');
  if (g.ok === false) return g;
  const [stored, set, careTeam] = await Promise.all([
    deps.latestDigest(viewer.organizationId, clientId),
    deps.loadSources(viewer.organizationId, clientId),
    canGenerateChartDigest(viewer.role) ? deps.onCareTeam(viewer, clientId) : Promise.resolve(false),
  ]);
  const { selected } = selectSources(set);
  const fresh = digestStaleness(stored, computeSourceHash(selected));
  let digest = stored ? parseDigestJson(stored.digestJson)?.digest ?? null : null;
  // A Part 2 consent revoked after generation: its facts are withheld right away
  const part2Withheld = Boolean(digest?.hasPart2 && !set.part2ConsentCovers);
  if (digest && part2Withheld) digest = withoutPart2(digest);
  await deps.audit({
    action: 'READ',
    outcome: 'SUCCESS',
    clientId,
    metadata: { feature: CHART_DIGEST_FEATURE, version: stored?.version ?? null, stale: fresh.stale, staleReason: fresh.reason, part2Withheld, counts: digest ? digestCounts(digest) : {} },
  });
  return {
    ok: true,
    view: {
      clientId,
      digest,
      version: stored?.version ?? null,
      status: stored?.status ?? null,
      generatedAt: stored ? stored.generatedAt.toISOString() : null,
      model: stored?.model ?? null,
      stale: fresh.stale,
      staleReason: fresh.reason,
      canRegenerate: careTeam,
      part2Withheld,
    },
  };
}

export async function generateForViewer(deps: DigestDeps, viewer: DigestViewer, clientId: string): Promise<GenerateResult> {
  const g = await gate(deps, viewer, clientId, 'AI_ACCESS');
  if (g.ok === false) return g;
  if (!canGenerateChartDigest(viewer.role) || !(await deps.onCareTeam(viewer, clientId))) {
    await deps.audit({ action: 'AI_ACCESS', outcome: 'DENIED', clientId, metadata: { feature: CHART_DIGEST_FEATURE, reason: 'not_on_care_team' } });
    return { ok: false, status: 403, reason: 'not_on_care_team' };
  }
  const r = await buildChartDigest(deps, { organizationId: viewer.organizationId, clientId, actorId: viewer.userId, allowOcr: true });
  if (r.ok === false) await deps.audit({ action: 'AI_ACCESS', outcome: 'DENIED', clientId, metadata: { feature: CHART_DIGEST_FEATURE, reason: r.reason } });
  return r;
}
