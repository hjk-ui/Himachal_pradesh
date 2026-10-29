/**
 * Grounding check for AI pre-visit bullets. Pure.
 *
 * A bullet is kept only when every date, number and ICD-10 code in it appears in the facts the
 * model was given, it does not use relative or non-ISO dates we cannot check, and it does not
 * name the client. Anything else is dropped (and counted) rather than shown.
 */
import { modelFacts, type PreVisitFacts } from '@/lib/ai/previsit/facts';

export const MAX_BULLETS = 8;
export const MAX_BULLET_CHARS = 300;

export type DropReason =
  | 'empty'
  | 'too_long'
  | 'ungrounded_date'
  | 'unverifiable_date'
  | 'ungrounded_number'
  | 'ungrounded_code'
  | 'names_client'
  | 'duplicate'
  | 'over_limit';

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const INSTRUMENT = /\b(?:PHQ-?9|GAD-?7|C-?SSRS|PHQ-?2|GAD-?2|PCL-?5|AUDIT-?C|DAST-?10)\b/gi;
const ICD = /\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?\b/g;
const NUMBER = /\d+(?:\.\d+)?/g;
const MONTH_DATE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b/i;
const SLASH_DATE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/;
const RELATIVE = /\b(?:yesterday|tomorrow|last (?:week|month|year)|next (?:week|month)|\d+\s+(?:days?|weeks?|months?)\s+ago|ago)\b/i;

/** Dates, numbers and codes the facts contain (what a bullet may cite) */
export function groundingSets(facts: PreVisitFacts) {
  const text = JSON.stringify(modelFacts(facts));
  const dates = new Set(text.match(ISO_DATE) ?? []);
  const codes = new Set((text.replace(ISO_DATE, ' ').match(ICD) ?? []).map((c) => c.toUpperCase()));
  const numbers = new Set<string>();
  const rest = text.replace(ISO_DATE, ' ').replace(INSTRUMENT, ' ');
  for (const n of rest.match(NUMBER) ?? []) numbers.add(normNum(n));
  return { dates, codes, numbers };
}

function normNum(n: string): string {
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : n;
}

function nameTokens(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) for (const p of (n || '').split(/[\s,]+/)) {
    const t = p.replace(/[^\p{L}'-]/gu, '');
    if (t.length >= 3) out.add(t.toLowerCase());
  }
  return [...out];
}

export function checkBullet(
  bullet: string,
  sets: ReturnType<typeof groundingSets>,
  names: string[]
): DropReason | null {
  const text = bullet.trim();
  if (!text) return 'empty';
  if (text.length > MAX_BULLET_CHARS) return 'too_long';
  const lower = text.toLowerCase();
  for (const t of nameTokens(names)) if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu').test(lower)) return 'names_client';
  for (const d of text.match(ISO_DATE) ?? []) if (!sets.dates.has(d)) return 'ungrounded_date';
  const noIso = text.replace(ISO_DATE, ' ');
  if (MONTH_DATE.test(noIso) || SLASH_DATE.test(noIso) || RELATIVE.test(noIso)) return 'unverifiable_date';
  for (const c of noIso.match(ICD) ?? []) if (!sets.codes.has(c.toUpperCase())) return 'ungrounded_code';
  const numeric = noIso.replace(INSTRUMENT, ' ').replace(ICD, ' ');
  for (const n of numeric.match(NUMBER) ?? []) if (!sets.numbers.has(normNum(n))) return 'ungrounded_number';
  return null;
}

/** Parse the model's JSON reply into candidate bullets ({"bullets": [...]}, tolerant of a bare array). */
export function parseModelBullets(reply: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { bullets?: unknown }).bullets : null;
  if (!Array.isArray(list)) return [];
  return list
    .map((b) => (typeof b === 'string' ? b : b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
    .map((b) => b.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim());
}

export function groundedBullets(
  candidates: string[],
  facts: PreVisitFacts,
  names: string[]
): { kept: string[]; dropped: DropReason[] } {
  const sets = groundingSets(facts);
  const kept: string[] = [];
  const dropped: DropReason[] = [];
  const seen = new Set<string>();
  for (const b of candidates) {
    const reason = checkBullet(b, sets, names);
    if (reason) {
      dropped.push(reason);
      continue;
    }
    const key = b.toLowerCase().replace(/\W+/g, ' ').trim();
    if (seen.has(key)) {
      dropped.push('duplicate');
      continue;
    }
    if (kept.length >= MAX_BULLETS) {
      dropped.push('over_limit');
      continue;
    }
    seen.add(key);
    kept.push(b.trim());
  }
  return { kept, dropped };
}
