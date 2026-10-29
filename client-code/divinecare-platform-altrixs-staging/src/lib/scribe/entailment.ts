/**
 * Entailment second pass for AI Scribe drafts ("does source X support claim Y?"). Pure: the route
 * injects the Bedrock call (Claude Haiku, guard 'clinical', temperature 0), so the selection, the
 * batching, the cap and the verdict rules are testable.
 *
 * Which sentences: weak ones, ones with a negation, ones in risk / mental status / medication
 * sections, and (Spanish / translated sessions) every sentence citing a transcript line, because
 * lexical overlap means little across languages. Each claim goes with ONLY its cited lines.
 *   yes    → supported (it replaces lexical overlap)
 *   partly → weak (highlighted; withheld in a risk / MSE / medication section)
 *   no     → withheld ("The cited lines do not support it")
 * Batches of ENTAIL_BATCH claims per call, at most ENTAIL_MAX_CALLS calls per draft. Not configured,
 * failed or over the cap: the deterministic rules stand (grounding.ts + polarity.ts).
 */
import { hasNegation } from './polarity';
import type { CheckedSentence, Source } from './grounding';

export type Verdict = 'yes' | 'no' | 'partly';
export const ENTAIL_BATCH = 15;
export const ENTAIL_MAX_CALLS = 3;

/** Risk, mental status and medication sections: a weak sentence there is withheld, not inserted. */
export const SENSITIVE_SECTION =
  /risk|suicid|homicid|self-harm|safety|mental status|^exam$|^mse|medication|^meds|side effects|med changes|allerg|abuse|violence|crisis/i;

/**
 * Substance use history: a drug named there is what the client used, not a prescription, so naming
 * it does not make the sentence a medication sentence (a weak one stays, highlighted, instead of
 * being withheld). Risk / MSE / medication headings keep the strict rule.
 */
export const SUBSTANCE_HISTORY_HEADING = /^substance (use|treatment)|^medical [/] substance history$|substance use history/i;
export function drugNameSensitive(heading: string | null, drugsNamed: number): boolean {
  return drugsNamed > 0 && !SUBSTANCE_HISTORY_HEADING.test(heading ?? '');
}

export function isSensitiveTarget(target: string, heading: string | null): boolean {
  if (target.startsWith('mse.')) return true;
  return SENSITIVE_SECTION.test(heading ?? '') || /^(si|hi|selfHarm|currentMeds|medChanges)$/.test(target);
}

export const entailKey = (s: { text: string; cites: string[] }) => `${s.text.trim()}|${[...s.cites].map((c) => c.toLowerCase()).sort().join(',')}`;

export type EntailCandidate = { key: string; text: string; cites: string[] };

/** Sentences that get the second pass (not withheld, cite at least one transcript line). */
export function entailmentCandidates(
  items: (CheckedSentence & { target: string; heading: string | null })[],
  opts: { crossLanguage: boolean; sensitive?: (it: { text: string; target: string; heading: string | null }) => boolean }
): EntailCandidate[] {
  const out = new Map<string, EntailCandidate>();
  const sens = (it: { text: string; target: string; heading: string | null }) => isSensitiveTarget(it.target, it.heading) || Boolean(opts.sensitive?.(it));
  for (const it of items) {
    if (it.status === 'withheld' || !it.cites.some((c) => /^t\d+$/.test(c))) continue;
    const want = opts.crossLanguage || it.status === 'weak' || hasNegation(it.text) || sens(it);
    if (!want) continue;
    const key = entailKey(it);
    if (!out.has(key)) out.set(key, { key, text: it.text, cites: it.cites });
  }
  // Most at-risk first: sensitive + negated + weak, so the cap drops the least important
  const rank = (c: EntailCandidate) => {
    const it = items.find((i) => entailKey(i) === c.key)!;
    return (sens(it) ? 0 : 2) + (hasNegation(it.text) ? 0 : 1) + (it.status === 'weak' ? 0 : 1);
  };
  return [...out.values()].sort((a, b) => rank(a) - rank(b));
}

export const ENTAILMENT_SYSTEM_PROMPT = `You check clinical documentation against its sources. For each claim you get ONLY the source lines it cites (transcript lines of a therapy session; they may be in Spanish while the claim is in English).
For each claim answer whether the sources support it:
- "yes": the sources state it (same meaning, same polarity: a denial is supported only by a denial).
- "partly": some of it is stated, but part is added, stronger, or interpreted.
- "no": the sources do not say it, or say the opposite.
Judge meaning only. Do not use outside knowledge. Return JSON: {"results":[{"id":"e1","verdict":"yes|partly|no"}]}`;

export function buildEntailmentPrompt(batch: EntailCandidate[], sources: Map<string, Source>): { userPrompt: string; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const blocks = batch.map((c, i) => {
    const id = `e${i + 1}`;
    ids.set(id, c.key);
    const lines = c.cites
      .map((x) => sources.get(x.toLowerCase()))
      .filter((s): s is Source => Boolean(s))
      .map((s) => `  ${s.id}: ${s.text}`)
      .join('\n');
    return `${id}\nSOURCES:\n${lines}\nCLAIM: ${c.text}`;
  });
  return { userPrompt: blocks.join('\n\n'), ids };
}

export function parseEntailmentReply(reply: string, ids: Map<string, string>): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return out;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return out;
    }
  }
  const results = (parsed as { results?: unknown })?.results;
  if (!Array.isArray(results)) return out;
  for (const r of results) {
    const id = String((r as { id?: unknown })?.id ?? '').trim().toLowerCase();
    const v = String((r as { verdict?: unknown })?.verdict ?? '').trim().toLowerCase();
    const key = ids.get(id);
    if (key && (v === 'yes' || v === 'no' || v === 'partly')) out.set(key, v);
  }
  return out;
}

export type EntailmentRun = { verdicts: Map<string, Verdict>; calls: number; checked: number; skipped: number; failed: boolean };

/** Run the capped, batched second pass. `invoke` null (Bedrock not configured) → nothing checked. */
export async function runEntailment(
  candidates: EntailCandidate[],
  sources: Map<string, Source>,
  invoke: ((args: { system: string; userPrompt: string }) => Promise<string>) | null,
  opts: { batch?: number; maxCalls?: number } = {}
): Promise<EntailmentRun> {
  const batchSize = opts.batch ?? ENTAIL_BATCH;
  const maxCalls = opts.maxCalls ?? ENTAIL_MAX_CALLS;
  const verdicts = new Map<string, Verdict>();
  if (!invoke || !candidates.length) return { verdicts, calls: 0, checked: 0, skipped: candidates.length, failed: false };
  let calls = 0;
  let failed = false;
  for (let i = 0; i < candidates.length && calls < maxCalls; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const { userPrompt, ids } = buildEntailmentPrompt(batch, sources);
    calls++;
    try {
      const reply = await invoke({ system: ENTAILMENT_SYSTEM_PROMPT, userPrompt });
      for (const [k, v] of parseEntailmentReply(reply, ids)) verdicts.set(k, v);
    } catch {
      failed = true;
      break;
    }
  }
  return { verdicts, calls, checked: verdicts.size, skipped: candidates.length - verdicts.size, failed };
}

/** Apply a verdict and the sensitive-section rule to one checked sentence. */
export function applyVerdict(c: CheckedSentence, verdict: Verdict | undefined, sensitive: boolean): CheckedSentence {
  let out = c;
  if (verdict && c.status !== 'withheld') {
    if (verdict === 'no') out = { ...c, status: 'withheld', reason: 'not_entailed', support: 0, entailment: 'no' };
    else if (verdict === 'partly') out = { ...c, status: 'weak', entailment: 'partly' };
    else out = { ...c, status: 'supported', entailment: 'yes', flags: c.flags?.filter((f) => !/^negation not in/.test(f)) };
    if (out.flags && !out.flags.length) delete out.flags;
  }
  if (sensitive && out.status === 'weak') return { ...out, status: 'withheld', reason: 'weak_sensitive' };
  return out;
}
