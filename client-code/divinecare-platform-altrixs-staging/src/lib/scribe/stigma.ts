/**
 * Stigmatizing-language lint for notes. Pure, browser-safe. Deterministic lexicon (person-first,
 * non-judgmental language; NIDA "Words Matter", Joint Commission Quick Safety 2022 on stigmatizing
 * language in the record). Applied to AI Scribe drafts (rewrite suggestion in review) and to the
 * pre-sign note quality check (warn). Never rewrites a note on its own.
 */

export type StigmaTerm = {
  id: string;
  re: RegExp;
  /** Replacement suggestion; null = flag only (clinical judgment needed) */
  suggestion: string | null;
  why: string;
};

export const STIGMA_LEXICON: readonly StigmaTerm[] = [
  { id: 'noncompliant', re: /\bnon-?complian(t|ce)\b/gi, suggestion: 'not taking as prescribed / not following the plan', why: 'describes behavior without blame' },
  { id: 'refused', re: /\brefus(ed|es|ing)\b/gi, suggestion: 'declined', why: 'neutral wording for a client choice' },
  { id: 'drug_abuser', re: /\b(drug|substance) abusers?\b/gi, suggestion: 'person who uses drugs', why: 'person-first language' },
  { id: 'addict', re: /\baddicts?\b/gi, suggestion: 'person with a substance use disorder', why: 'person-first language' },
  { id: 'alcoholic', re: /\balcoholics?\b/gi, suggestion: 'person with alcohol use disorder', why: 'person-first language' },
  { id: 'clean', re: /\b(clean|dirty)\s+(uds|urine|drug screen|tox(icology)? screen|test|screen)s?\b|\b(uds|urine|drug screen|tox(icology)? screen)\s+(was|is|came back)\s+(clean|dirty)\b/gi, suggestion: 'negative / positive', why: 'clinical result terms' },
  { id: 'suffers_from', re: /\bsuffer(s|ed|ing)? from\b/gi, suggestion: 'has / lives with', why: 'neutral, not victimizing' },
  { id: 'manipulative', re: /\bmanipulative\b/gi, suggestion: null, why: 'judgmental: describe the behavior observed' },
  { id: 'attention_seeking', re: /\battention[- ]seeking\b/gi, suggestion: null, why: 'judgmental: describe the behavior observed' },
  { id: 'drug_seeking', re: /\bdrug[- ]seeking\b/gi, suggestion: null, why: 'judgmental: describe the request and the clinical concern' },
  { id: 'frequent_flyer', re: /\bfrequent fl(y|i)ers?\b/gi, suggestion: null, why: 'judgmental: state the number of visits' },
  { id: 'malingering', re: /\bmalinger(ing|er|s)?\b/gi, suggestion: null, why: 'a clinical conclusion: document the evidence, or leave it out' },
];

export type StigmaFinding = { id: string; match: string; suggestion: string | null; why: string };

export function lintStigma(text: string): StigmaFinding[] {
  const out: StigmaFinding[] = [];
  for (const t of STIGMA_LEXICON) {
    for (const m of text.matchAll(new RegExp(t.re.source, t.re.flags))) out.push({ id: t.id, match: m[0], suggestion: t.suggestion, why: t.why });
  }
  return out;
}

const keepCase = (from: string, to: string) => (/^[A-Z]/.test(from) ? to.charAt(0).toUpperCase() + to.slice(1) : to);

/** One replacement per term ("refused" → "declined"); flag-only terms are left as written. */
export function rewriteStigma(text: string): string {
  let out = text;
  out = out.replace(/\bnon-?compliant with (?:(?:his|her|their) )?(medications?|meds)\b/gi, (m) => keepCase(m, 'not taking medications as prescribed'));
  out = out.replace(/\bnon-?complian(t|ce)\b/gi, (m) => keepCase(m, 'not following the plan'));
  out = out.replace(/\brefus(ed|es|ing)\b/gi, (m, suf: string) => keepCase(m, suf === 'ed' ? 'declined' : suf === 'es' ? 'declines' : 'declining'));
  out = out.replace(/\b(drug|substance) abusers?\b/gi, (m) => keepCase(m, /s$/i.test(m) ? 'people who use drugs' : 'person who uses drugs'));
  out = out.replace(/\baddicts?\b/gi, (m) => keepCase(m, /s$/i.test(m) ? 'people with a substance use disorder' : 'person with a substance use disorder'));
  out = out.replace(/\balcoholics?\b/gi, (m) => keepCase(m, /s$/i.test(m) ? 'people with alcohol use disorder' : 'person with alcohol use disorder'));
  out = out.replace(/\bclean(\s+(?:uds|urine|drug screen|tox(?:icology)? screen|test|screen)s?)\b/gi, (m, rest: string) => keepCase(m, `negative${rest}`));
  out = out.replace(/\bdirty(\s+(?:uds|urine|drug screen|tox(?:icology)? screen|test|screen)s?)\b/gi, (m, rest: string) => keepCase(m, `positive${rest}`));
  out = out.replace(/\b((?:uds|urine|drug screen|tox(?:icology)? screen)\s+(?:was|is|came back)\s+)clean\b/gi, '$1negative');
  out = out.replace(/\b((?:uds|urine|drug screen|tox(?:icology)? screen)\s+(?:was|is|came back)\s+)dirty\b/gi, '$1positive');
  out = out.replace(/\bsuffer(s|ed|ing)? from\b/gi, (m, suf: string | undefined) => keepCase(m, suf === 'ed' ? 'had' : suf === 'ing' ? 'living with' : suf === 's' ? 'has' : 'have'));
  return out;
}

export const STIGMA_PROMPT_RULE =
  'Use person-first, non-judgmental language: "not taking as prescribed" (not "noncompliant"), "declined" (not "refused"), "person who uses drugs" / "with alcohol use disorder" (not "addict", "abuser", "alcoholic"), "negative / positive" drug screen (not "clean / dirty"), "has / lives with" (not "suffers from"). Never write "manipulative", "attention-seeking", "drug-seeking", "frequent flyer" or "malingering": describe what was said or observed.';
