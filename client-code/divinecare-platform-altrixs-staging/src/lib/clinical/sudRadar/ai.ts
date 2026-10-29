/**
 * Optional AI confirmation of medium/low keyword hits (Bedrock Haiku, JSON mode).
 * The model sees only the quoted evidence sentences — never the whole chart — and its answer
 * can only drop a negated / not-about-the-patient hit or adjust confidence. On any failure the
 * caller keeps the rule-based result. Pure apart from the injected `invoke`.
 */
import { z } from 'zod';
import type { SourcedHit } from './notes';

export type AiInvoke = (input: { system: string; userPrompt: string }) => Promise<string>;

export const AI_MAX_SNIPPETS = 10;

const SYSTEM = [
  'You review short excerpts from behavioral-health clinical notes for a substance-use screening tool.',
  'For each excerpt decide only: is substance use negated/denied; is it about the patient (not a relative or other person);',
  'is it current use (within roughly the last 12 months) or historical; which substance.',
  'Use only the excerpt text. Do not diagnose, do not suggest codes, do not add findings.',
  'Answer as JSON: {"results":[{"id":"<id>","negated":bool,"aboutPatient":bool,"current":bool,"historical":bool}]}',
].join(' ');

const resultSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        negated: z.boolean(),
        aboutPatient: z.boolean(),
        current: z.boolean(),
        historical: z.boolean().optional().default(false),
      })
    )
    .max(50),
});

export type AiVerdict = z.infer<typeof resultSchema>['results'][number];

/** Hits worth a second look: medium / low confidence only (high hits are kept as is). */
export function hitsForAiReview(hits: SourcedHit[]): SourcedHit[] {
  return hits.filter((h) => h.confidence !== 'high').slice(0, AI_MAX_SNIPPETS);
}

export function buildAiPrompt(hits: SourcedHit[]): string {
  const lines = hits.map((h, i) => `${i + 1}. id=${h.key} substance-term="${h.term}" excerpt="${h.quote.replace(/"/g, "'")}"`);
  return `Excerpts:\n${lines.join('\n')}`;
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

/**
 * Applies verdicts: negated or not-about-the-patient → hit dropped; current → low raised to
 * medium; historical → low + chart documentation. Hits without a verdict are unchanged.
 */
export function applyAiVerdicts(hits: SourcedHit[], verdicts: Map<string, AiVerdict>): { hits: SourcedHit[]; dropped: number } {
  const out: SourcedHit[] = [];
  let dropped = 0;
  for (const h of hits) {
    const v = verdicts.get(h.key);
    if (!v || h.confidence === 'high') {
      out.push(h);
      continue;
    }
    if (v.negated || !v.aboutPatient) {
      dropped += 1;
      continue;
    }
    if (v.current && !v.historical) {
      out.push({ ...h, confidence: h.confidence === 'low' ? 'medium' : h.confidence, aiVerdict: 'confirmed' });
    } else if (v.historical) {
      out.push({ ...h, confidence: 'low', action: 'chart-documentation', aiVerdict: 'historical' });
    } else {
      out.push({ ...h, aiVerdict: 'uncertain' });
    }
  }
  return { hits: out, dropped };
}

export async function confirmHitsWithAi(
  hits: SourcedHit[],
  invoke: AiInvoke
): Promise<{ ok: true; hits: SourcedHit[]; reviewed: number; dropped: number } | { ok: false; hits: SourcedHit[] }> {
  const review = hitsForAiReview(hits);
  if (!review.length) return { ok: true, hits, reviewed: 0, dropped: 0 };
  try {
    const raw = await invoke({ system: SYSTEM, userPrompt: buildAiPrompt(review) });
    const verdicts = parseAiVerdicts(raw);
    if (!verdicts) return { ok: false, hits };
    const applied = applyAiVerdicts(hits, verdicts);
    return { ok: true, hits: applied.hits, reviewed: review.length, dropped: applied.dropped };
  } catch {
    return { ok: false, hits };
  }
}
