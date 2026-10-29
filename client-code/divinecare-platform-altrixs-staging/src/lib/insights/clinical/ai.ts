/**
 * Clinical Insights — AI features (decision support, server side only). Pure: no prisma / AWS
 * imports; routes pass real dependencies, tests pass fakes.
 *
 * a) Client snapshot: 3–5 sentences on what changed and what needs attention, from numbered facts
 *    (the rule engine's signals, trajectories and data gaps — no names, no note text), plus next
 *    actions chosen from the fixed NEXT_ACTIONS list. The clinician decides.
 * b) Population narrative ("what changed"): from aggregated statistics only (no client-level data;
 *    cells under n=10 are never sent). Each sentence cites the statistics it uses.
 * c) Natural-language filter: the query is translated into the page's structured filters (closed
 *    lists of ids / keys — never SQL); anything not in the lists is dropped and reported.
 *
 * Guardrail (reused from the Service Eligibility Scanner, src/lib/clinical/serviceEligibility/ai.ts):
 * every sentence must cite existing fact ids, and every date, number, ICD-10 code, instrument and
 * medication it mentions must appear in the facts IT CITES. One failing sentence withholds the
 * whole output. AI runs only when Bedrock is configured; client features also require that the
 * client has not declined AI use and is not a protected (42 CFR Part 2) record.
 */
import { createHash } from 'node:crypto';
import { checkSentence, parseRationale, type RationaleFact, type RationaleSentence } from '@/lib/clinical/serviceEligibility/ai';
import { CARE_GAP_KEYS, CARE_GAPS, EMPTY_FILTERS, MIN_CELL, NO_PROGRAM, type InsightFilters, type PopulationView, type TileCounts } from './population';
import { NEXT_ACTION_IDS, NEXT_ACTIONS, SIGNAL_KEYS, SIGNAL_META, type NextActionId } from './rules';
import { SIGNAL_CATEGORIES, TIER_LABEL, TIERS, type ClientFacts, type Evaluation, type SignalCategory, type SignalKey, type Tier } from './types';

export const SNAPSHOT_FEATURE = 'clinical-insights-snapshot';
export const NARRATIVE_FEATURE = 'clinical-insights-narrative';
export const NL_FILTER_FEATURE = 'clinical-insights-nl-filter';
export const AI_TTL_MS = 6 * 60 * 60_000;
export const SNAPSHOT_MAX_SENTENCES = 5;
export const NARRATIVE_MAX_SENTENCES = 6;
export const NL_QUERY_MAX = 200;

export const SNAPSHOT_LABEL = 'AI decision support — grounded only in the numbered chart facts below. Not a diagnosis or a prediction; the clinician decides.';
export const NARRATIVE_LABEL = 'AI summary of the aggregated statistics below (no client-level data was sent). Check each cited statistic.';

export type Fact = RationaleFact;
export type Sentence = RationaleSentence;

export const factsHash = (facts: Fact[]) => createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 24);
const numbered = (lines: string[], prefix = 'fact') => [...new Set(lines)].slice(0, 45).map((text, i) => ({ id: `${prefix}${i + 1}`, text }));

// ─── Guardrail ──────────────────────────────────────────────────────────────

/** Why one sentence fails, or null. Numbers / dates / instruments must be in the CITED facts. */
export function checkCitedSentence(s: Sentence, facts: Fact[], names: string[]): string | null {
  const ids = new Set(facts.map((f) => f.id));
  if (!s.text) return 'empty';
  if (!s.cites.length) return 'no_citation';
  if (s.cites.some((c) => !ids.has(c))) return 'unknown_citation';
  const cited = facts.filter((f) => s.cites.includes(f.id));
  return checkSentence(s, cited, names);
}

export function guardSentences(sentences: Sentence[], facts: Fact[], names: string[], max: number): { ok: boolean; reasons: string[] } {
  if (!sentences.length) return { ok: false, reasons: ['no_sentences'] };
  if (sentences.length > max) return { ok: false, reasons: ['too_many_sentences'] };
  const reasons = sentences.map((s) => checkCitedSentence(s, facts, names)).filter((r): r is string => r !== null);
  return { ok: reasons.length === 0, reasons };
}

export type AiCache<T> = { get(key: string): T | undefined; set(key: string, v: T): void };
export type AiAudit = (entry: { outcome: 'SUCCESS' | 'FAILURE'; metadata: Record<string, unknown> }) => Promise<void>;
export type Invoke = (input: { system: string; userPrompt: string }) => Promise<string>;

// ─── a) Client snapshot ─────────────────────────────────────────────────────

/** Numbered facts for one client (deterministic order, no names, no free text). */
export function snapshotFacts(ev: Evaluation, f: ClientFacts, today: string): Fact[] {
  const lines: string[] = [`As of ${today}, rule-based priority tier: ${TIER_LABEL[ev.tier]}${ev.rules.length ? ` (rules ${ev.rules.join(', ')})` : ''}`];
  for (const s of ev.signals) lines.push(`${SIGNAL_META[s.key].category} signal (${s.level}): ${s.detail}`);
  for (const t of ev.trajectories) {
    const parts = [`${t.label} latest ${t.latest.score} on ${t.latest.date}`];
    if (t.prior) parts.push(`prior ${t.prior.score} on ${t.prior.date}`);
    if (t.baseline) parts.push(`baseline ${t.baseline.score} on ${t.baseline.date}`);
    parts.push(`${t.scores} score${t.scores === 1 ? '' : 's'} in 12 months`);
    parts.push(`trajectory ${t.status.replace('_', ' ')}${t.stale ? ' (latest score older than 90 days)' : ''}`);
    lines.push(parts.join('; '));
  }
  lines.push(f.lastVisit ? `Last attended visit ${f.lastVisit}` : 'No attended visit on file');
  lines.push(f.nextAppointment ? `Next scheduled appointment ${f.nextAppointment}` : 'No future appointment scheduled');
  lines.push(f.safetyPlan ? 'Safety plan on file' : 'No safety plan on file');
  for (const g of ev.dataGaps) lines.push(`Missing from chart: ${g}`);
  return numbered(lines);
}

export const SNAPSHOT_SYSTEM_PROMPT = `You write a short clinical snapshot for a licensed behavioral health clinician reviewing a worklist.
You receive numbered chart facts (fact1, fact2, ...) produced by a transparent rules engine (not a prediction model).
Rules:
- Write 3 to 5 sentences: what changed recently, and what needs attention now. Most important first.
- Use ONLY the numbered facts. Do not add any diagnosis, score, date, medication, history or number not in the facts.
- Every sentence must cite the fact ids it uses, e.g. ["fact2","fact5"]. Numbers and dates must come from the cited facts.
- Dates only as written in the facts (YYYY-MM-DD). No relative dates ("last week", "ago").
- Do not name the client. Do not predict outcomes, estimate probabilities, or make the decision.
- Then choose 0 to 3 next actions ONLY from this list of ids, each citing the facts that support it:
${NEXT_ACTION_IDS.map((id) => `  ${id}: ${NEXT_ACTIONS[id]}`).join('\n')}
Return JSON: {"sentences":[{"text":"...","cites":["fact1"]}],"actions":[{"id":"schedule_follow_up","cites":["fact3"]}]}`;

export type SnapshotAction = { id: NextActionId; label: string; cites: string[] };

export type SnapshotResult =
  | { status: 'ok'; sentences: Sentence[]; actions: SnapshotAction[]; facts: Fact[]; model: string; generatedAt: string; cached: boolean; droppedActions: number }
  | { status: 'unavailable'; reason: 'ai_not_configured' | 'ai_consent_declined' | 'protected_record'; message: string; facts: Fact[] }
  | { status: 'rejected'; reason: 'ungrounded_output' | 'ai_failed'; message: string; facts: Fact[]; dropped?: string[] };

export function parseActions(reply: string, facts: Fact[]): { actions: SnapshotAction[]; dropped: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { actions: [], dropped: 0 };
  }
  const list = parsed && typeof parsed === 'object' ? (parsed as { actions?: unknown }).actions : null;
  if (!Array.isArray(list)) return { actions: [], dropped: 0 };
  const ids = new Set(facts.map((f) => f.id));
  const out: SnapshotAction[] = [];
  let dropped = 0;
  for (const a of list) {
    const id = a && typeof a === 'object' ? (a as { id?: unknown }).id : null;
    const cites = a && typeof a === 'object' && Array.isArray((a as { cites?: unknown }).cites)
      ? ((a as { cites: unknown[] }).cites.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toLowerCase()))
      : [];
    if (typeof id !== 'string' || !(NEXT_ACTION_IDS as string[]).includes(id) || !cites.length || cites.some((c) => !ids.has(c)) || out.some((x) => x.id === id)) {
      dropped += 1;
      continue;
    }
    out.push({ id: id as NextActionId, label: NEXT_ACTIONS[id as NextActionId], cites });
  }
  return { actions: out.slice(0, 3), dropped: dropped + Math.max(0, out.length - 3) };
}

export type SnapshotDeps = {
  bedrockConfigured(): boolean;
  aiConsent(): Promise<'signed' | 'missing' | 'declined'>;
  isProtected(): Promise<boolean>;
  invokeModel: Invoke;
  modelId: string;
  audit: AiAudit;
  cache: AiCache<SnapshotResult>;
  now?: () => Date;
};

export async function getClientSnapshot(
  deps: SnapshotDeps,
  input: { organizationId: string; clientId: string; facts: Fact[]; names: string[]; refresh?: boolean }
): Promise<SnapshotResult> {
  const { facts } = input;
  if (await deps.isProtected()) {
    return { status: 'unavailable', reason: 'protected_record', message: 'AI unavailable — protected record (42 CFR Part 2). The signals below are rule-based.', facts };
  }
  if ((await deps.aiConsent()) === 'declined') {
    return { status: 'unavailable', reason: 'ai_consent_declined', message: 'AI unavailable — the client declined AI use. Nothing was sent to the model.', facts };
  }
  if (!deps.bedrockConfigured()) {
    return { status: 'unavailable', reason: 'ai_not_configured', message: 'AI unavailable — AWS Bedrock is not configured on this server.', facts };
  }
  const key = `${input.organizationId}:${input.clientId}:${factsHash(facts)}`;
  if (!input.refresh) {
    const hit = deps.cache.get(key);
    if (hit && hit.status === 'ok') return { ...hit, cached: true };
  }
  const base = { feature: SNAPSHOT_FEATURE, model: deps.modelId, facts: facts.length };
  let reply: string;
  try {
    reply = await deps.invokeModel({ system: SNAPSHOT_SYSTEM_PROMPT, userPrompt: `Chart facts:\n${facts.map((f) => `${f.id}: ${f.text}`).join('\n')}` });
  } catch (err) {
    await deps.audit({ outcome: 'FAILURE', metadata: { ...base, error: err instanceof Error ? err.name : 'unknown' } });
    return { status: 'rejected', reason: 'ai_failed', message: 'AI unavailable — the model call failed. The signals below are rule-based.', facts };
  }
  const sentences = parseRationale(reply);
  const guard = guardSentences(sentences, facts, input.names, SNAPSHOT_MAX_SENTENCES);
  const { actions, dropped } = parseActions(reply, facts);
  await deps.audit({ outcome: guard.ok ? 'SUCCESS' : 'FAILURE', metadata: { ...base, sentences: sentences.length, grounded: guard.ok, actions: actions.length, droppedActions: dropped, reasons: guard.reasons.slice(0, 4) } });
  if (!guard.ok) {
    return { status: 'rejected', reason: 'ungrounded_output', message: 'AI summary withheld — it mentioned facts not in the chart data. The signals below are rule-based.', facts, dropped: guard.reasons };
  }
  const out: SnapshotResult = { status: 'ok', sentences, actions, facts, model: deps.modelId, generatedAt: (deps.now?.() ?? new Date()).toISOString(), cached: false, droppedActions: dropped };
  deps.cache.set(key, out);
  return out;
}

// ─── b) Population narrative ────────────────────────────────────────────────

const pct = (r: { pct: number | null; num: number; den: number; suppressed: boolean }) =>
  r.suppressed || r.pct == null ? null : `${r.pct}% (${r.num} of ${r.den})`;

/** Numbered statistics (aggregates only; suppressed cells and clinician names are left out). */
export function narrativeFacts(view: PopulationView, tiles: TileCounts, asOf: string): Fact[] {
  const lines: string[] = [];
  lines.push(`As of ${asOf}: ${view.kpis.clients} clients in scope; ${tiles.tiers.urgent} Urgent, ${tiles.tiers.high} High, ${tiles.tiers.watch} Watch, ${tiles.tiers.stable} Stable (rule-based tiers)`);
  const w = pct(view.kpis.worsening);
  if (w) lines.push(`Clients with a current symptom trajectory who are reliably worsening: ${w}`);
  const i = pct(view.kpis.improving);
  if (i) lines.push(`Clients with a current symptom trajectory who are reliably improving: ${i}`);
  const m = pct(view.kpis.measurement);
  if (m) lines.push(`Clients seen in the last 90 days with a PHQ-9 in the last 90 days: ${m}`);
  for (const g of CARE_GAP_KEYS) lines.push(`Care gap "${CARE_GAPS[g].label}": ${tiles.careGaps[g]} clients`);
  for (const s of view.trends.shifts) {
    const sh = s.shift;
    if (sh.reason === 'suppressed_small_n') continue;
    lines.push(`${s.label}: ${s.period} ${pct(sh.now)} vs ${s.previous} ${pct(sh.prev)}; change ${sh.diffPts! > 0 ? '+' : ''}${sh.diffPts} points; ${sh.flagged ? `flagged as a statistically meaningful shift (z ${sh.z})` : 'not a statistically meaningful shift'}`);
  }
  for (const dim of ['location', 'program', 'payer', 'dxGroup'] as const) {
    for (const b of view.breakdowns[dim].filter((x) => !x.suppressed).slice(0, 4)) {
      const parts = [pct(b.worsening) && `worsening ${pct(b.worsening)}`, pct(b.noShow) && `no-show rate ${pct(b.noShow)}`, pct(b.urgentHigh) && `Urgent or High ${pct(b.urgentHigh)}`].filter(Boolean);
      if (parts.length) lines.push(`${dim === 'dxGroup' ? 'Diagnosis group' : dim[0].toUpperCase() + dim.slice(1)} "${b.label}" (${b.clients} clients): ${parts.join('; ')}`);
    }
  }
  return numbered(lines, 'stat');
}

export const NARRATIVE_SYSTEM_PROMPT = `You write a short "what changed this week" summary for behavioral health clinic leadership.
You receive numbered aggregate statistics (stat1, stat2, ...). There is no client-level data.
Rules:
- Write 3 to 6 sentences: the most important changes and care gaps first; mention flagged shifts, and say plainly when a change was not statistically meaningful.
- Use ONLY the statistics. Every number and date must come from the statistics you cite. No relative dates.
- Every sentence must cite the stat ids it uses, e.g. ["stat2"].
- Do not speculate about causes, do not predict, and do not recommend staffing or clinical decisions.
Return JSON: {"sentences":[{"text":"...","cites":["stat1"]}]}`;

export type NarrativeResult =
  | { status: 'ok'; sentences: Sentence[]; facts: Fact[]; model: string; generatedAt: string; cached: boolean }
  | { status: 'unavailable'; reason: 'ai_not_configured' | 'too_few_clients'; message: string; facts: Fact[] }
  | { status: 'rejected'; reason: 'ungrounded_output' | 'ai_failed'; message: string; facts: Fact[]; dropped?: string[] };

export async function getNarrative(
  deps: { bedrockConfigured(): boolean; invokeModel: Invoke; modelId: string; audit: AiAudit; cache: AiCache<NarrativeResult>; now?: () => Date },
  input: { scopeKey: string; view: PopulationView; tiles: TileCounts; asOf: string; refresh?: boolean }
): Promise<NarrativeResult> {
  const facts = narrativeFacts(input.view, input.tiles, input.asOf);
  if (input.view.kpis.clients < MIN_CELL) {
    return { status: 'unavailable', reason: 'too_few_clients', message: `Not enough clients in scope for a population summary (fewer than ${MIN_CELL}).`, facts: [] };
  }
  if (!deps.bedrockConfigured()) {
    return { status: 'unavailable', reason: 'ai_not_configured', message: 'AI unavailable — AWS Bedrock is not configured on this server.', facts };
  }
  const key = `${input.scopeKey}:${factsHash(facts)}`;
  if (!input.refresh) {
    const hit = deps.cache.get(key);
    if (hit && hit.status === 'ok') return { ...hit, cached: true };
  }
  const base = { feature: NARRATIVE_FEATURE, model: deps.modelId, facts: facts.length };
  let reply: string;
  try {
    reply = await deps.invokeModel({ system: NARRATIVE_SYSTEM_PROMPT, userPrompt: `Statistics:\n${facts.map((f) => `${f.id}: ${f.text}`).join('\n')}` });
  } catch (err) {
    await deps.audit({ outcome: 'FAILURE', metadata: { ...base, error: err instanceof Error ? err.name : 'unknown' } });
    return { status: 'rejected', reason: 'ai_failed', message: 'AI unavailable — the model call failed.', facts };
  }
  const sentences = parseRationale(reply);
  const guard = guardSentences(sentences, facts, [], NARRATIVE_MAX_SENTENCES);
  await deps.audit({ outcome: guard.ok ? 'SUCCESS' : 'FAILURE', metadata: { ...base, sentences: sentences.length, grounded: guard.ok, reasons: guard.reasons.slice(0, 4) } });
  if (!guard.ok) {
    return { status: 'rejected', reason: 'ungrounded_output', message: 'AI summary withheld — it mentioned numbers that are not in the statistics.', facts, dropped: guard.reasons };
  }
  const out: NarrativeResult = { status: 'ok', sentences, facts, model: deps.modelId, generatedAt: (deps.now?.() ?? new Date()).toISOString(), cached: false };
  deps.cache.set(key, out);
  return out;
}

// ─── c) Natural-language filter ─────────────────────────────────────────────

export type FilterOptions = {
  clinicians: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  programs: string[];
  payers: string[];
  dxGroups: string[];
};

export function nlSystemPrompt(o: FilterOptions, viewerIsCaseload: boolean): string {
  const list = (xs: string[]) => xs.map((x) => JSON.stringify(x)).join(', ');
  return `You translate a clinician's request into filters for a clinical worklist. You never write SQL.
Return JSON with only these optional keys (omit what the request does not ask for):
{"tiers":[...],"locationId":"...","clinicianId":"...","program":"...","payer":"...","dxGroup":"...","category":"...","signal":"...","careGap":"...","myCaseload":true,"noFutureAppt":true}
Allowed values (use them exactly; if nothing matches, omit the key):
- tiers: ${list([...TIERS])} (urgent > high > watch > stable)
- locationId: ${o.locations.map((l) => `${JSON.stringify(l.id)} = ${l.name}`).join('; ') || '(none)'}
- clinicianId: ${o.clinicians.map((c) => `${JSON.stringify(c.id)} = ${c.name}`).join('; ') || '(none)'}
- program: ${list(o.programs)}
- payer: ${list(o.payers)}
- dxGroup: ${list(o.dxGroups)}
- category: ${list([...SIGNAL_CATEGORIES])}
- signal: ${SIGNAL_KEYS.map((k) => `${JSON.stringify(k)} = ${SIGNAL_META[k].title}`).join('; ')}
- careGap: ${CARE_GAP_KEYS.map((k) => `${JSON.stringify(k)} = ${CARE_GAPS[k].label}`).join('; ')}
- myCaseload: true when the request says "my clients" / "my caseload"${viewerIsCaseload ? ' (the viewer already sees only their caseload)' : ''}
- noFutureAppt: true when the request asks for clients with no appointment scheduled
"worsening" means signal "worsening"; "improving" means signal "improving".
Return JSON: {"filters":{...},"unmatched":["parts of the request you could not map"]}`;
}

export type NlFilterResult =
  | { status: 'ok'; filters: InsightFilters; applied: string[]; ignored: string[]; model: string }
  | { status: 'unavailable'; reason: 'ai_not_configured' | 'empty_query'; message: string }
  | { status: 'rejected'; reason: 'ai_failed' | 'nothing_matched'; message: string; ignored?: string[] };

/** Validate the model's filters against the closed option lists (anything else is dropped). */
export function validateNlFilters(raw: unknown, o: FilterOptions): { filters: InsightFilters; applied: string[]; ignored: string[] } {
  const f: InsightFilters = { ...EMPTY_FILTERS, tiers: [] };
  const applied: string[] = [];
  const ignored: string[] = [];
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const filters = obj.filters && typeof obj.filters === 'object' ? (obj.filters as Record<string, unknown>) : obj;
  const str = (k: string) => (typeof filters[k] === 'string' ? (filters[k] as string).trim() : null);
  if (Array.isArray(filters.tiers)) {
    for (const t of filters.tiers) {
      if (typeof t === 'string' && (TIERS as readonly string[]).includes(t.toLowerCase())) f.tiers.push(t.toLowerCase() as Tier);
      else ignored.push(`tier ${String(t)}`);
    }
    if (f.tiers.length) applied.push(`Tier: ${f.tiers.map((t) => TIER_LABEL[t]).join(', ')}`);
  }
  const pick = <T extends string>(key: string, allowed: readonly T[], label: (v: T) => string, set: (v: T) => void) => {
    const v = str(key);
    if (v == null) return;
    const hit = allowed.find((a) => a === v);
    if (hit) {
      set(hit);
      applied.push(label(hit));
    } else ignored.push(`${key} ${v}`);
  };
  pick('locationId', o.locations.map((l) => l.id), (v) => `Location: ${o.locations.find((l) => l.id === v)!.name}`, (v) => (f.locationId = v));
  pick('clinicianId', o.clinicians.map((c) => c.id), (v) => `Clinician: ${o.clinicians.find((c) => c.id === v)!.name}`, (v) => (f.clinicianId = v));
  pick('program', [...o.programs, NO_PROGRAM], (v) => `Program: ${v}`, (v) => (f.program = v));
  pick('payer', o.payers, (v) => `Payer: ${v}`, (v) => (f.payer = v));
  pick('dxGroup', o.dxGroups, (v) => `Diagnosis group: ${v}`, (v) => (f.dxGroup = v));
  pick<SignalCategory>('category', SIGNAL_CATEGORIES, (v) => `Signal type: ${v}`, (v) => (f.category = v));
  pick<SignalKey>('signal', SIGNAL_KEYS, (v) => `Signal: ${SIGNAL_META[v].title}`, (v) => (f.signal = v));
  pick('careGap', CARE_GAP_KEYS, (v) => `Care gap: ${CARE_GAPS[v].label}`, (v) => (f.careGap = v));
  if (filters.myCaseload === true) {
    f.myCaseload = true;
    applied.push('My caseload');
  }
  if (filters.noFutureAppt === true) {
    f.noFutureAppt = true;
    applied.push('No future appointment');
  }
  if (Array.isArray(obj.unmatched)) for (const u of obj.unmatched) if (typeof u === 'string' && u.trim()) ignored.push(u.trim().slice(0, 80));
  return { filters: f, applied, ignored };
}

export async function translateNlFilter(
  deps: { bedrockConfigured(): boolean; invokeModel: Invoke; modelId: string; audit: AiAudit },
  input: { query: string; options: FilterOptions; viewerIsCaseload: boolean }
): Promise<NlFilterResult> {
  const query = input.query.trim().slice(0, NL_QUERY_MAX);
  if (!query) return { status: 'unavailable', reason: 'empty_query', message: 'Type what you are looking for.' };
  if (!deps.bedrockConfigured()) return { status: 'unavailable', reason: 'ai_not_configured', message: 'AI unavailable — AWS Bedrock is not configured on this server. Use the filters below.' };
  let reply: string;
  try {
    reply = await deps.invokeModel({ system: nlSystemPrompt(input.options, input.viewerIsCaseload), userPrompt: `Request: ${query}` });
  } catch (err) {
    await deps.audit({ outcome: 'FAILURE', metadata: { feature: NL_FILTER_FEATURE, model: deps.modelId, error: err instanceof Error ? err.name : 'unknown' } });
    return { status: 'rejected', reason: 'ai_failed', message: 'AI unavailable — the model call failed. Use the filters below.' };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(reply);
  } catch {
    parsed = null;
  }
  const v = validateNlFilters(parsed, input.options);
  await deps.audit({ outcome: v.applied.length ? 'SUCCESS' : 'FAILURE', metadata: { feature: NL_FILTER_FEATURE, model: deps.modelId, applied: v.applied.length, ignored: v.ignored.length, queryChars: query.length } });
  if (!v.applied.length) return { status: 'rejected', reason: 'nothing_matched', message: 'Could not match that request to the filters on this page.', ignored: v.ignored };
  return { status: 'ok', filters: v.filters, applied: v.applied, ignored: v.ignored, model: deps.modelId };
}

