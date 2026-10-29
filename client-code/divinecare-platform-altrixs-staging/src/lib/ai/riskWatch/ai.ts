/**
 * Risk language watch: optional AI classification of flagged snippets (Bedrock Haiku, JSON mode).
 *
 * - Only ambiguous LOW / MEDIUM rule hits are sent. HIGH hits are never sent and never changed.
 * - The model sees the matched sentence ± 1 sentence with names, contact details and numbers
 *   redacted — never the whole note, thread or chart.
 * - The AI may only downgrade (medium → low, low → dismissed). Every downgrade is returned so the
 *   caller can log it. On any failure the rule result stands.
 * Pure apart from the injected `invoke`.
 */
import { z } from 'zod';
import type { RiskHit, RiskScan } from './engine';
import { maxSeverity } from './engine';
import type { RiskSeverity } from './phrases';

export type AiInvoke = (input: { system: string; userPrompt: string }) => Promise<string>;

export const AI_MAX_SNIPPETS = 6;
export const AI_TIMEOUT_MS = 6000;

export const RISK_AI_SYSTEM = [
  'You review short excerpts flagged by a behavioral-health risk language screen. This is decision support; a clinician reviews every flag.',
  'For each excerpt decide only: is risk to self or others (or danger from someone else) actually expressed;',
  'is it about the patient/writer (not a friend, relative, character or the news); is it negated/denied; is it a figure of speech, joke-free idiom, or about something else (e.g. ending a relationship).',
  'If unsure, answer riskPresent true. Use only the excerpt. Do not diagnose or give advice.',
  'Answer as JSON: {"results":[{"id":"<id>","riskPresent":bool,"aboutPatient":bool,"negated":bool,"figurative":bool}]}',
].join(' ');

const resultSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        riskPresent: z.boolean(),
        aboutPatient: z.boolean(),
        negated: z.boolean(),
        figurative: z.boolean().optional().default(false),
      })
    )
    .max(50),
});
export type AiVerdict = z.infer<typeof resultSchema>['results'][number];

export type AiDowngrade = {
  hitKey: string;
  phraseId: string;
  from: RiskSeverity;
  to: RiskSeverity | 'dismissed';
  reason: 'no-risk' | 'not-about-patient' | 'negated' | 'figurative';
};

/** Only ambiguous low/medium hits are eligible for AI review. */
export function hitsForAiReview(hits: RiskHit[]): RiskHit[] {
  return hits.filter((h) => h.ambiguous && h.severity !== 'high').slice(0, AI_MAX_SNIPPETS);
}

const STOP_CAPITALS = new Set([
  'I', 'I’m', "I'm", 'Pt', 'Patient', 'Client', 'SI', 'HI', 'Dr', 'Mr', 'Mrs', 'Ms',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'God', 'ER', 'ED', 'OD', 'NSSI', 'HOME', 'PHQ', 'C-SSRS',
]);

/**
 * Minimum text for the model: the hit sentence with its neighbours, names redacted.
 * Redacts the client's name parts, other capitalised words mid-sentence (likely names / places),
 * emails, phone numbers, long digit runs and dates.
 */
export function buildSnippet(scan: RiskScan, hit: RiskHit, nameParts: string[] = []): string {
  const parts = scan.sentences.slice(Math.max(0, hit.sentenceIndex - 1), hit.sentenceIndex + 2);
  return redactNames(parts.join(' '), nameParts).slice(0, 700);
}

export function redactNames(text: string, nameParts: string[] = []): string {
  let out = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]')
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[date]')
    .replace(/\b\d{4,}\b/g, '[number]');
  for (const raw of nameParts) {
    const n = raw.trim();
    if (n.length < 2) continue;
    out = out.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[name]');
  }
  // Capitalised words that do not start a sentence: likely names or places
  out = out.replace(/(?<![.!?]\s|^|\[)\b([A-Z][a-z’']+(?:-[A-Z][a-z]+)?)\b/g, (w) => (STOP_CAPITALS.has(w) ? w : '[name]'));
  return out;
}

export function buildAiPrompt(items: { id: string; snippet: string }[]): string {
  return `Excerpts:\n${items.map((it, i) => `${i + 1}. id=${it.id} excerpt="${it.snippet.replace(/"/g, "'")}"`).join('\n')}`;
}

export function parseAiVerdicts(raw: string): Map<string, AiVerdict> | null {
  try {
    const parsed = resultSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return new Map(parsed.data.results.map((r) => [r.id, r]));
  } catch {
    return null;
  }
}

function downgradeReason(v: AiVerdict): AiDowngrade['reason'] | null {
  if (v.negated) return 'negated';
  if (!v.aboutPatient) return 'not-about-patient';
  if (v.figurative) return 'figurative';
  if (!v.riskPresent) return 'no-risk';
  return null;
}

/**
 * Applies verdicts. A HIGH hit, a non-ambiguous hit or a hit without a verdict is never changed.
 * A "no risk" verdict on an eligible hit moves it down one step: medium → low, low → dismissed.
 */
export function applyAiVerdicts(scan: RiskScan, verdicts: Map<string, AiVerdict>): { scan: RiskScan; downgrades: AiDowngrade[] } {
  const hits: RiskHit[] = [];
  const downgrades: AiDowngrade[] = [];
  for (const h of scan.hits) {
    const v = verdicts.get(h.key);
    const reason = v ? downgradeReason(v) : null;
    if (!v || !reason || h.severity === 'high' || !h.ambiguous) {
      hits.push(h);
      continue;
    }
    if (h.severity === 'medium') {
      downgrades.push({ hitKey: h.key, phraseId: h.phraseId, from: 'medium', to: 'low', reason });
      hits.push({ ...h, severity: 'low', reasons: [...h.reasons, `ai-downgrade:${reason}`] });
    } else {
      downgrades.push({ hitKey: h.key, phraseId: h.phraseId, from: 'low', to: 'dismissed', reason });
    }
  }
  return { scan: { ...scan, hits, severity: maxSeverity(hits.map((x) => x.severity)) }, downgrades };
}

export type AiReviewResult =
  | { status: 'skipped'; reason: 'none-eligible' | 'consent-declined' | 'not-configured'; scan: RiskScan; downgrades: [] }
  | { status: 'ok'; scan: RiskScan; reviewed: number; downgrades: AiDowngrade[] }
  | { status: 'failed'; scan: RiskScan; reviewed: number; downgrades: [] };

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AI_TIMEOUT')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Sends eligible snippets to the model; on any failure returns the rule result unchanged. */
export async function reviewWithAi(
  scan: RiskScan,
  invoke: AiInvoke,
  opts: { nameParts?: string[]; timeoutMs?: number } = {}
): Promise<AiReviewResult> {
  const eligible = hitsForAiReview(scan.hits);
  if (!eligible.length) return { status: 'skipped', reason: 'none-eligible', scan, downgrades: [] };
  try {
    const items = eligible.map((h) => ({ id: h.key, snippet: buildSnippet(scan, h, opts.nameParts) }));
    const raw = await withTimeout(invoke({ system: RISK_AI_SYSTEM, userPrompt: buildAiPrompt(items) }), opts.timeoutMs ?? AI_TIMEOUT_MS);
    const verdicts = parseAiVerdicts(raw);
    if (!verdicts) return { status: 'failed', scan, reviewed: eligible.length, downgrades: [] };
    const applied = applyAiVerdicts(scan, verdicts);
    return { status: 'ok', scan: applied.scan, reviewed: eligible.length, downgrades: applied.downgrades };
  } catch {
    return { status: 'failed', scan, reviewed: eligible.length, downgrades: [] };
  }
}
