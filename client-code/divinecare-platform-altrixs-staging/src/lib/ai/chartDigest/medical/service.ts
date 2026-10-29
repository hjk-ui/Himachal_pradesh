/**
 * Medical (primary care) chart history digest orchestration. No prisma / AWS imports: real
 * dependencies come from medical/store.ts, tests pass fakes.
 *
 * Same safety model as the BH digest (../service.ts): sources → cached text extraction (Textract
 * only for scanned pages) → client names redacted → monthly chunks → Bedrock map step (Haiku,
 * temperature 0) → every citation checked against the source text (uncited facts dropped) →
 * deterministic merge → stored as ClientChartDigest kind 'medical' with its own source hash
 * (incremental: unchanged months reuse their validated facts). Psychotherapy notes are never read;
 * Part 2 SUD-program records only with an active Part 2 consent covering treatment.
 *
 * Sources: primary-care documents (medical/classify.ts) and signed MedicalVisit notes. Structured
 * records (problems, medications, allergies, vitals, labs, referrals, BH minimum necessary) and the
 * preventive-care "due" list are added at view time from the live records (medical/structured.ts).
 *
 * Gates: view = access.ts canViewChartDigest(role, 'medical') + the chart gate (org, care team /
 * caseload, Part 2 / VIP lock) + a primary-care patient; the medical assistant gets the
 * minimum-necessary subset. Regenerate = primary-care providers on the care team. Audited with ids
 * and counts only.
 */
import { chunkConcurrency, mapLimit, withThrottleRetry } from '@/lib/ai/chartDigest/concurrency';
import { redactNames } from '@/lib/ai/previsit/facts';
import { canGenerateChartDigest, canViewChartDigest, medicalAudienceFor, type MedicalAudience } from '@/lib/ai/chartDigest/access';
import { chunkSources, renderChunk, sizeOf, sourceAliases } from '@/lib/ai/chartDigest/chunk';
import { decideSource, isPart2Source } from '@/lib/ai/chartDigest/classify';
import { digestPrices, tokenCost } from '@/lib/ai/chartDigest/cost';
import { SECTION_CAPS, mergeItems, mergeMedicationTrials } from '@/lib/ai/chartDigest/merge';
import { classifyMedicalDocument } from '@/lib/ai/chartDigest/medical/classify';
import { MEDICAL_DIGEST_SYSTEM_PROMPT, medicalDigestUserPrompt } from '@/lib/ai/chartDigest/medical/prompt';
import {
  applyMedicalMinimumNecessary,
  combineMedicalDigest,
  medicalWithoutPart2,
  preventiveDueFrom,
  restrictForMedicalAssistant,
  structuredMedicalFacts,
  type StructuredSet,
} from '@/lib/ai/chartDigest/medical/structured';
import {
  MEDICAL_DIGEST_FEATURE,
  MEDICAL_DIGEST_PROMPT_VERSION,
  MEDICAL_ITEM_SECTIONS,
  emptyMedicalSections,
  medicalDigestCounts,
  type MedicalDigest,
  type MedicalItemSection,
  type MedicalSections,
} from '@/lib/ai/chartDigest/medical/types';
import { computeSourceHash, digestStaleness, type DigestDeps, type DigestViewer, type DocRow, type StoredDigest } from '@/lib/ai/chartDigest/service';
import type { ChartSource } from '@/lib/ai/chartDigest/types';
import { SourceIndex, addDrops, emptyDropCounts, validateReplySections, type DropCounts } from '@/lib/ai/chartDigest/validate';

export type VisitRow = {
  id: string;
  visitType: string;
  visitDate: Date;
  chiefComplaint: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  icd10Codes: string[];
  signedAt: Date | null;
  updatedAt: Date;
};

export type MedicalSourceSet = {
  docs: DocRow[];
  /** Signed MedicalVisit notes */
  visits: VisitRow[];
  part2Client: boolean;
  part2ConsentCovers: boolean;
  /** The patient also has a behavioral health chart (generic note types then need a Family Practice marker) */
  behavioral: boolean;
};

export type MedicalDigestDeps = Omit<DigestDeps, 'loadSources'> & {
  loadMedicalSources(organizationId: string, clientId: string): Promise<MedicalSourceSet>;
  loadStructured(organizationId: string, clientId: string, now: Date): Promise<StructuredSet>;
  isPrimaryCare(organizationId: string, clientId: string): Promise<boolean>;
};

export type MedicalDigestJson = {
  digest: MedicalDigest;
  chunkCache: { key: string; sections: MedicalSections }[];
  pendingSources: string[];
};

// ─── Source selection (pure) ─────────────────────────────────────────────────

export type SelectedMedicalSource = Omit<ChartSource, 'pages'> & { doc?: DocRow; visit?: VisitRow };

function fieldValue(fields: unknown, label: string): string | null {
  if (!Array.isArray(fields)) return null;
  const f = (fields as Array<{ label?: unknown; value?: unknown }>).find((x) => x && x.label === label);
  return typeof f?.value === 'string' ? f.value : null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function selectMedicalSources(set: MedicalSourceSet): { selected: SelectedMedicalSource[]; excluded: Record<string, number> } {
  const excluded: Record<string, number> = {};
  const bump = (r: string) => (excluded[r] = (excluded[r] ?? 0) + 1);
  const selected: SelectedMedicalSource[] = [];
  for (const d of set.docs) {
    const input = { documentType: d.documentType, fileName: d.fileName, sourcePath: d.sourcePath, title: fieldValue(d.extractedFields, 'Title'), folder: fieldValue(d.extractedFields, 'Valant folder') };
    const cls = classifyMedicalDocument(input, { behavioral: set.behavioral });
    if (cls.include === false) {
      bump(cls.reason);
      continue;
    }
    const dec = decideSource({ part2: isPart2Source({ kind: 'doc', part2Client: set.part2Client, doc: input }), part2ConsentCovers: set.part2ConsentCovers });
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
  for (const v of set.visits) {
    if (!v.signedAt) {
      bump('unsigned_visit');
      continue;
    }
    selected.push({ key: `visit:${v.id}`, kind: 'note', id: v.id, date: ymd(v.visitDate), label: `Office visit: ${v.visitType || 'Visit'}`.slice(0, 40), part2: false, version: v.updatedAt.toISOString(), visit: v });
  }
  return { selected, excluded };
}

/** Plain text of a signed visit note (SOAP sections as written) */
export function visitText(v: VisitRow): string {
  return [
    v.chiefComplaint ? `Chief complaint: ${v.chiefComplaint}` : '',
    v.subjective ? `Subjective: ${v.subjective}` : '',
    v.objective ? `Objective: ${v.objective}` : '',
    v.assessment ? `Assessment: ${v.assessment}` : '',
    v.plan ? `Plan: ${v.plan}` : '',
    v.icd10Codes.length ? `ICD-10: ${v.icd10Codes.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function computeMedicalSourceHash(selected: Array<Pick<SelectedMedicalSource, 'key' | 'version' | 'part2'>>): string {
  return computeSourceHash(selected, MEDICAL_DIGEST_PROMPT_VERSION);
}

export function parseMedicalDigestJson(v: unknown): MedicalDigestJson | null {
  if (!v || typeof v !== 'object') return null;
  const j = v as Partial<MedicalDigestJson>;
  if (!j.digest || typeof j.digest !== 'object') return null;
  const digest = { ...emptyMedicalSections(), ...(j.digest as MedicalDigest), kind: 'medical' as const };
  return { digest, chunkCache: Array.isArray(j.chunkCache) ? j.chunkCache : [], pendingSources: Array.isArray(j.pendingSources) ? j.pendingSources : [] };
}

// ─── Merge (pure, deterministic) ─────────────────────────────────────────────

const MEDICAL_CAPS: Record<MedicalItemSection, number> = {
  problems: 25,
  allergies: 15,
  labs: 30,
  vitals: 12,
  preventive: 15,
  hospitalizations: 15,
  referrals: 12,
  socialFunctional: 10,
  openItems: 8,
  bhSummary: 8,
};

const latestCite = (cs: { date: string }[]) => cs.reduce((m, c) => (c.date > m ? c.date : m), '');

export function mergeMedicalSections(chunks: MedicalSections[], sources: MedicalDigest['sources']): MedicalDigest {
  const out = emptyMedicalSections();
  for (const s of MEDICAL_ITEM_SECTIONS) out[s] = mergeItems(chunks.map((c) => c[s] ?? []));
  out.medicationTrials = mergeMedicationTrials(chunks.map((c) => c.medicationTrials ?? []));
  const newest = out.openItems.reduce((m, i) => (latestCite(i.cites) > m ? latestCite(i.cites) : m), '');
  out.openItems = out.openItems.filter((i) => latestCite(i.cites) === newest);
  for (const s of MEDICAL_ITEM_SECTIONS) out[s] = out[s].slice(-MEDICAL_CAPS[s]);
  out.medicationTrials = out.medicationTrials.slice(-SECTION_CAPS.medicationTrials);
  const safe = applyMedicalMinimumNecessary(out);
  const hasPart2 = [...MEDICAL_ITEM_SECTIONS.flatMap((s) => safe[s]), ...safe.medicationTrials].some((i) => i.part2);
  return { ...safe, kind: 'medical', sources, hasPart2 };
}

// ─── Generation ──────────────────────────────────────────────────────────────

export type MedicalGenerateSummary = {
  version: number;
  status: StoredDigest['status'];
  sources: number;
  excluded: Record<string, number>;
  part2Sources: number;
  pendingSources: number;
  unavailableSources: number;
  chunks: number;
  chunksReused: number;
  modelCalls: number;
  failedCalls: number;
  factsKept: number;
  drops: DropCounts;
  tokensIn: number;
  tokensOut: number;
  costEstimateUsd: number;
  counts: Record<string, number>;
};

export type MedicalGenerateResult =
  | { ok: true; digest: StoredDigest; summary: MedicalGenerateSummary; skipped: boolean; status?: undefined; reason?: undefined }
  | { ok: false; status: 403 | 404 | 409 | 503; reason: string; digest?: undefined; summary?: undefined; skipped?: undefined };

export async function buildMedicalDigest(
  deps: MedicalDigestDeps,
  input: { organizationId: string; clientId: string; actorId: string | null; allowOcr: boolean; force?: boolean }
): Promise<MedicalGenerateResult> {
  const now = (deps.now ?? (() => new Date()))();
  const { organizationId: org, clientId } = input;
  if (!(await deps.isPrimaryCare(org, clientId))) return { ok: false, status: 404, reason: 'not_primary_care' };
  if ((await deps.aiConsent(org, clientId)) === 'declined') return { ok: false, status: 409, reason: 'ai_consent_declined' };
  if (!deps.bedrockConfigured()) return { ok: false, status: 503, reason: 'ai_not_configured' };

  const set = await deps.loadMedicalSources(org, clientId);
  const { selected, excluded } = selectMedicalSources(set);
  const sourceHash = computeMedicalSourceHash(selected);
  const prev = await deps.latestDigest(org, clientId);
  const fresh = digestStaleness(prev, sourceHash);
  const counts0 = (p: StoredDigest) => {
    const j = parseMedicalDigestJson(p.digestJson);
    return j ? medicalDigestCounts(j.digest) : {};
  };
  if (prev && !fresh.stale && !input.force) {
    return {
      ok: true,
      digest: prev,
      skipped: true,
      summary: { version: prev.version, status: prev.status, sources: prev.sourceDocIds.length, excluded, part2Sources: 0, pendingSources: 0, unavailableSources: 0, chunks: 0, chunksReused: 0, modelCalls: 0, failedCalls: 0, factsKept: 0, drops: emptyDropCounts(), tokensIn: 0, tokensOut: 0, costEstimateUsd: 0, counts: counts0(prev) },
    };
  }

  const names = await deps.clientNames(org, clientId);
  const sources: ChartSource[] = [];
  const pending: string[] = [];
  let unavailable = 0;
  for (const s of selected) {
    let pages: string[] = [];
    if (s.visit) pages = [visitText(s.visit)];
    else if (s.doc) {
      const r = await deps.extract(s.doc, { allowOcr: input.allowOcr });
      if (r.state === 'ready') {
        pages = r.pages;
        if (r.scannedPages && r.method === 'pdf_text') unavailable++;
      } else if (r.state === 'pending') pending.push(s.key);
      else unavailable++;
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
  const prevJson = prev && prev.promptVersion === MEDICAL_DIGEST_PROMPT_VERSION && prev.model === deps.modelId ? parseMedicalDigestJson(prev.digestJson) : null;
  const cache = new Map((prevJson?.chunkCache ?? []).map((c) => [c.key, c.sections]));

  const chunkCache: MedicalDigestJson['chunkCache'] = [];
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
      const reply = await withThrottleRetry(() => deps.invokeModel({ system: MEDICAL_DIGEST_SYSTEM_PROMPT, userPrompt: medicalDigestUserPrompt(text) }), { sleep: deps.sleep });
      const v = validateReplySections(reply.text, MEDICAL_ITEM_SECTIONS, aliasToKey, index, part2Keys);
      return { state: 'mapped' as const, key: chunk.key, sections: applyMedicalMinimumNecessary({ ...v.items, medicationTrials: v.medicationTrials }), drops: v.drops, kept: v.kept, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut };
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

  const sourceMeta: MedicalDigest['sources'] = {};
  for (const s of sources) sourceMeta[s.key] = { date: s.date, label: s.label, part2: s.part2, pageCount: s.pages.length };
  const digest = mergeMedicalSections(chunkCache.map((c) => c.sections), sourceMeta);
  const counts = medicalDigestCounts(digest);
  const allFailed = failed > 0 && failed === calls && reused === 0;
  const status: StoredDigest['status'] = allFailed ? 'failed' : failed || pending.length || truncated || unavailable ? 'partial' : 'ready';
  const costEstimateUsd = Math.round(tokenCost(tokensIn, tokensOut, digestPrices()) * 10_000) / 10_000;
  const errorList = [
    ...(failed ? [{ code: 'map_failed', count: failed, kinds: [...new Set(errors)].slice(0, 5) }] : []),
    ...(pending.length ? [{ code: 'text_pending', count: pending.length }] : []),
    ...(unavailable ? [{ code: 'text_unavailable', count: unavailable }] : []),
    ...(truncated ? [{ code: 'truncated_oldest_chunks', count: truncated }] : []),
  ];
  const json: MedicalDigestJson = { digest, chunkCache, pendingSources: pending };
  const saved = await deps.saveDigest({
    organizationId: org,
    clientId,
    version: (prev?.version ?? 0) + 1,
    status,
    digestJson: json,
    sourceDocIds: selected.map((s) => s.key),
    sourceHash,
    model: deps.modelId,
    promptVersion: MEDICAL_DIGEST_PROMPT_VERSION,
    tokensIn,
    tokensOut,
    costEstimateUsd,
    generatedById: input.actorId,
    generatedAt: now,
    errors: errorList,
  });
  const summary: MedicalGenerateSummary = {
    version: saved.version,
    status,
    sources: sources.length,
    excluded,
    part2Sources: part2Keys.size,
    pendingSources: pending.length,
    unavailableSources: unavailable,
    chunks: chunks.length,
    chunksReused: reused,
    modelCalls: calls,
    failedCalls: failed,
    factsKept: kept,
    drops,
    tokensIn,
    tokensOut,
    costEstimateUsd,
    counts,
  };
  await deps.audit({ action: 'AI_ACCESS', outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS', clientId, metadata: { feature: MEDICAL_DIGEST_FEATURE, kind: 'medical', model: deps.modelId, promptVersion: MEDICAL_DIGEST_PROMPT_VERSION, ...summary } });
  return { ok: true, digest: saved, summary, skipped: false };
}

// ─── Viewer entry points (route) ─────────────────────────────────────────────

export type MedicalDigestView = {
  kind: 'medical';
  clientId: string;
  audience: MedicalAudience;
  /** Always present: live record facts, plus the AI document facts once generated */
  digest: MedicalDigest;
  /** An AI document digest exists (generatedAt / version refer to it) */
  aiGenerated: boolean;
  version: number | null;
  status: StoredDigest['status'] | null;
  generatedAt: string | null;
  model: string | null;
  stale: boolean;
  staleReason: ReturnType<typeof digestStaleness>['reason'];
  canRegenerate: boolean;
  part2Withheld: boolean;
};

export type MedicalViewResult = { ok: true; view: MedicalDigestView; status?: undefined; reason?: undefined } | { ok: false; status: 403 | 404; reason: string; view?: undefined };

async function gateMedical(deps: MedicalDigestDeps, viewer: DigestViewer, clientId: string, action: 'READ' | 'AI_ACCESS'): Promise<{ ok: true } | { ok: false; status: 403 | 404; reason: string }> {
  const base = { feature: MEDICAL_DIGEST_FEATURE, kind: 'medical' };
  if (!canViewChartDigest(viewer.role, 'medical')) {
    await deps.audit({ action, outcome: 'DENIED', clientId, metadata: { ...base, reason: 'role_not_permitted' } });
    return { ok: false, status: 403, reason: 'role_not_permitted' };
  }
  const access = await deps.resolveAccess(viewer, clientId);
  if (access.ok === false) {
    await deps.audit({ action, outcome: 'DENIED', clientId, metadata: { ...base, reason: access.reason } });
    return { ok: false, status: access.status, reason: access.reason };
  }
  if (!(await deps.isPrimaryCare(viewer.organizationId, clientId))) {
    await deps.audit({ action, outcome: 'DENIED', clientId, metadata: { ...base, reason: 'not_primary_care' } });
    return { ok: false, status: 404, reason: 'not_primary_care' };
  }
  return { ok: true };
}

export async function viewMedicalDigest(deps: MedicalDigestDeps, viewer: DigestViewer, clientId: string): Promise<MedicalViewResult> {
  const g = await gateMedical(deps, viewer, clientId, 'READ');
  if (g.ok === false) return g;
  const now = (deps.now ?? (() => new Date()))();
  const audience = medicalAudienceFor(viewer.role);
  const [stored, set, structured, careTeam] = await Promise.all([
    deps.latestDigest(viewer.organizationId, clientId),
    deps.loadMedicalSources(viewer.organizationId, clientId),
    deps.loadStructured(viewer.organizationId, clientId, now),
    canGenerateChartDigest(viewer.role, 'medical') ? deps.onCareTeam(viewer, clientId) : Promise.resolve(false),
  ]);
  const fresh = digestStaleness(stored, computeMedicalSourceHash(selectMedicalSources(set).selected));
  let ai = stored && stored.status !== 'failed' ? parseMedicalDigestJson(stored.digestJson)?.digest ?? null : null;
  const part2Withheld = Boolean(ai?.hasPart2 && !set.part2ConsentCovers);
  if (ai && part2Withheld) ai = medicalWithoutPart2(ai);
  let digest = combineMedicalDigest(ai, structuredMedicalFacts(structured), preventiveDueFrom(structured.careGaps));
  if (audience === 'ma') digest = restrictForMedicalAssistant(digest);
  await deps.audit({
    action: 'READ',
    outcome: 'SUCCESS',
    clientId,
    metadata: { feature: MEDICAL_DIGEST_FEATURE, kind: 'medical', audience, version: stored?.version ?? null, stale: fresh.stale, staleReason: fresh.reason, part2Withheld, counts: medicalDigestCounts(digest) },
  });
  return {
    ok: true,
    view: {
      kind: 'medical',
      clientId,
      audience,
      digest,
      aiGenerated: Boolean(ai),
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

export async function generateMedicalForViewer(deps: MedicalDigestDeps, viewer: DigestViewer, clientId: string): Promise<MedicalGenerateResult> {
  const g = await gateMedical(deps, viewer, clientId, 'AI_ACCESS');
  if (g.ok === false) return g;
  if (!canGenerateChartDigest(viewer.role, 'medical') || !(await deps.onCareTeam(viewer, clientId))) {
    await deps.audit({ action: 'AI_ACCESS', outcome: 'DENIED', clientId, metadata: { feature: MEDICAL_DIGEST_FEATURE, kind: 'medical', reason: 'not_on_care_team' } });
    return { ok: false, status: 403, reason: 'not_on_care_team' };
  }
  const r = await buildMedicalDigest(deps, { organizationId: viewer.organizationId, clientId, actorId: viewer.userId, allowOcr: true });
  if (r.ok === false) await deps.audit({ action: 'AI_ACCESS', outcome: 'DENIED', clientId, metadata: { feature: MEDICAL_DIGEST_FEATURE, kind: 'medical', reason: r.reason } });
  return r;
}
