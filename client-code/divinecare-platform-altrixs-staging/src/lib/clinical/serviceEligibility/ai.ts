/**
 * AI clinical rationale for one scanner suggestion — decision support, server side only.
 * No prisma / AWS imports: the route passes real dependencies, tests pass fakes.
 *
 *  1. Facts are the evaluator's own output for the program (criteria met / not met / missing /
 *     flags and dated chart evidence), numbered fact1…factN. Client names never enter the prompt.
 *  2. AI only when Bedrock is configured, the client has not declined AI consent and the record is
 *     not a protected (42 CFR Part 2) record — otherwise the result says why ("AI unavailable").
 *  3. Guardrail: every sentence must cite at least one fact id that exists, and every date,
 *     number, ICD-10 code, instrument and antidepressant it mentions must appear in the facts. One
 *     failing sentence rejects the whole output (nothing partial is shown).
 *  4. Cached per org + client + program + facts hash (6 h); a changed chart changes the hash.
 */
import { createHash } from 'node:crypto';
import { checkBullet } from '@/lib/ai/previsit/validate';
import { antidepressantGeneric } from './codes';
import { PROGRAM_META } from './criteria';
import type { ProgramKey, ProgramResult } from './types';

export const RATIONALE_FEATURE = 'service-eligibility-rationale';
export const MAX_SENTENCES = 4;
export const RATIONALE_TTL_MS = 6 * 60 * 60_000;

export type RationaleFact = { id: string; text: string };
export type RationaleSentence = { text: string; cites: string[] };

export type RationaleResult =
  | { status: 'ok'; sentences: RationaleSentence[]; facts: RationaleFact[]; model: string; generatedAt: string; cached: boolean }
  | { status: 'unavailable'; reason: 'ai_not_configured' | 'ai_consent_declined' | 'protected_record' | 'no_facts'; message: string; facts: RationaleFact[] }
  | { status: 'rejected'; reason: 'ungrounded_output' | 'ai_failed'; message: string; facts: RationaleFact[]; dropped?: string[] };

export const RATIONALE_LABEL = 'AI decision support — grounded only in the listed chart facts. The clinician decides.';

const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** Numbered facts for one program result (deterministic order). */
export function rationaleFacts(r: ProgramResult): RationaleFact[] {
  const lines: string[] = [
    `Scanner status: ${r.status.replace('_', ' ')}`,
    ...r.met.map((t) => `Criterion met: ${t}`),
    ...r.unmet.map((t) => `Criterion not met: ${t}`),
    ...r.missing.map((t) => `Missing from chart: ${t}`),
    ...r.flags.map((t) => `Flag: ${t}`),
    ...r.evidence.map((e) => `Chart evidence (${e.kind}${e.date ? `, ${e.date}` : ''}): ${e.text}`),
  ];
  return [...new Set(lines)].slice(0, 40).map((text, i) => ({ id: `fact${i + 1}`, text }));
}

export function factsHash(facts: RationaleFact[]): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 24);
}

export const RATIONALE_SYSTEM_PROMPT = `You write a short clinical decision-support rationale for a licensed behavioral health clinician.
You receive numbered chart facts (fact1, fact2, ...) produced by a rules engine for one program.
Rules:
- Write 3 or 4 sentences explaining why the client may or may not meet the program criteria, and what is missing to confirm.
- Use ONLY the numbered facts. Do not add any diagnosis, score, date, medication, history, payer or number that is not in the facts.
- Every sentence must cite the facts it uses as fact ids, e.g. ["fact2","fact5"].
- Dates only as written in the facts (YYYY-MM-DD). No relative dates ("last month").
- Do not name the client. Do not make the decision: say "the clinician should confirm" where criteria are unconfirmed.
Return JSON: {"sentences":[{"text":"...","cites":["fact1"]}]}`;

export function rationaleUserPrompt(program: ProgramKey, facts: RationaleFact[]): string {
  const meta = PROGRAM_META[program];
  return `Program: ${meta.fullName}\nPublished criteria screened:\n${meta.criteria.map((c) => `- ${c}`).join('\n')}\n\nChart facts:\n${facts.map((f) => `${f.id}: ${f.text}`).join('\n')}`;
}

export function parseRationale(reply: string): RationaleSentence[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return [];
  }
  const list = parsed && typeof parsed === 'object' ? (parsed as { sentences?: unknown }).sentences : null;
  if (!Array.isArray(list)) return [];
  return list
    .filter((s): s is { text: string; cites?: unknown } => Boolean(s && typeof s === 'object' && typeof (s as { text?: unknown }).text === 'string'))
    .map((s) => ({ text: s.text.trim(), cites: Array.isArray(s.cites) ? s.cites.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toLowerCase()) : [] }));
}

const INSTRUMENTS = /\b(PHQ-?9|GAD-?7|C-?SSRS|LOCUS|ASAM|AUDIT|DAST)\b/gi;

/** Why a sentence fails the grounding check, or null when it passes. */
export function checkSentence(s: RationaleSentence, facts: RationaleFact[], names: string[]): string | null {
  const ids = new Set(facts.map((f) => f.id));
  if (!s.text) return 'empty';
  if (!s.cites.length) return 'no_citation';
  if (s.cites.some((c) => !ids.has(c))) return 'unknown_citation';
  const all = facts.map((f) => f.text).join('\n');
  // Strip inline citation markers ("[fact3]") before checking numbers (ids are not ICD-shaped)
  const text = s.text.replace(/\[?\bfact\d{1,3}\b\]?/gi, ' ');
  const dates = new Set(all.match(DATE_RE) ?? []);
  const noIso = all.replace(DATE_RE, ' ');
  const codes = new Set((noIso.match(/\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/g) ?? []).map((c) => c.toUpperCase()));
  const numbers = new Set<string>();
  for (const n of noIso.replace(INSTRUMENTS, ' ').match(/\d+(?:\.\d+)?/g) ?? []) numbers.add(String(Number(n)));
  const why = checkBullet(text, { dates, codes, numbers }, names);
  if (why) return why;
  const factLower = all.toLowerCase();
  for (const m of s.text.match(INSTRUMENTS) ?? []) {
    if (!factLower.replace(/-/g, '').includes(m.toLowerCase().replace(/-/g, ''))) return 'ungrounded_instrument';
  }
  const drug = antidepressantGeneric(s.text);
  if (drug && !factLower.includes(drug)) return 'ungrounded_medication';
  return null;
}

/** Whole-output guardrail: all sentences must pass, 1–4 sentences. */
export function guardRationale(sentences: RationaleSentence[], facts: RationaleFact[], names: string[]): { ok: boolean; reasons: string[] } {
  if (!sentences.length) return { ok: false, reasons: ['no_sentences'] };
  if (sentences.length > MAX_SENTENCES) return { ok: false, reasons: ['too_many_sentences'] };
  const reasons = sentences.map((s) => checkSentence(s, facts, names)).filter((r): r is string => r !== null);
  return { ok: reasons.length === 0, reasons };
}

export type RationaleDeps = {
  bedrockConfigured(): boolean;
  aiConsent(): Promise<'signed' | 'missing' | 'declined'>;
  isProtected(): Promise<boolean>;
  invokeModel(input: { system: string; userPrompt: string }): Promise<string>;
  modelId: string;
  audit(entry: { outcome: 'SUCCESS' | 'FAILURE'; metadata: Record<string, unknown> }): Promise<void>;
  cache: { get(key: string): RationaleResult | undefined; set(key: string, v: RationaleResult): void };
  now?: () => Date;
};

export async function getRationale(
  deps: RationaleDeps,
  input: { organizationId: string; clientId: string; program: ProgramKey; result: ProgramResult; names: string[]; refresh?: boolean }
): Promise<RationaleResult> {
  const facts = rationaleFacts(input.result);
  if (input.result.status === 'not_indicated' && !input.result.met.length) {
    return { status: 'unavailable', reason: 'no_facts', message: 'Not indicated — no qualifying chart facts to summarize.', facts };
  }
  if (await deps.isProtected()) {
    return { status: 'unavailable', reason: 'protected_record', message: 'AI unavailable — protected record (42 CFR Part 2); review the criteria below.', facts };
  }
  if ((await deps.aiConsent()) === 'declined') {
    return { status: 'unavailable', reason: 'ai_consent_declined', message: 'AI unavailable — the client declined AI use. Nothing was sent to the model.', facts };
  }
  if (!deps.bedrockConfigured()) {
    return { status: 'unavailable', reason: 'ai_not_configured', message: 'AI unavailable — AWS Bedrock is not configured on this server.', facts };
  }
  const key = `${input.organizationId}:${input.clientId}:${input.program}:${factsHash(facts)}`;
  if (!input.refresh) {
    const hit = deps.cache.get(key);
    if (hit && hit.status === 'ok') return { ...hit, cached: true };
  }
  const base = { feature: RATIONALE_FEATURE, program: input.program, model: deps.modelId, facts: facts.length };
  let reply: string;
  try {
    reply = await deps.invokeModel({ system: RATIONALE_SYSTEM_PROMPT, userPrompt: rationaleUserPrompt(input.program, facts) });
  } catch (err) {
    await deps.audit({ outcome: 'FAILURE', metadata: { ...base, error: err instanceof Error ? err.name : 'unknown' } });
    return { status: 'rejected', reason: 'ai_failed', message: 'AI unavailable — the model call failed. Review the criteria below.', facts };
  }
  const sentences = parseRationale(reply);
  const guard = guardRationale(sentences, facts, input.names);
  await deps.audit({ outcome: guard.ok ? 'SUCCESS' : 'FAILURE', metadata: { ...base, sentences: sentences.length, grounded: guard.ok, reasons: guard.reasons.slice(0, 4) } });
  if (!guard.ok) {
    return { status: 'rejected', reason: 'ungrounded_output', message: 'AI summary withheld — it mentioned facts not in the chart data. Review the criteria below.', facts, dropped: guard.reasons };
  }
  const out: RationaleResult = { status: 'ok', sentences, facts, model: deps.modelId, generatedAt: (deps.now?.() ?? new Date()).toISOString(), cached: false };
  deps.cache.set(key, out);
  return out;
}
